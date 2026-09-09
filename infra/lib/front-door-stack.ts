import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export interface FormEchoFrontDoorStackProps extends StackProps {
  /**
   * `next build` の出力ディレクトリ（`nextjs-app/out`）。
   *
   * WHY 引数で受けるか: テストを固定のフィクスチャで回すため。実際のビルド成果物に
   * 依存させると、クローン直後や CI で `npm test` が「まだビルドしていない」だけで落ちる。
   */
  readonly frontendOutDir: string;

  /**
   * BFF の Lambda エントリ（`hono-app/src/lambda.ts`）。
   *
   * WHY 引数で受けるか: `frontendOutDir` と同じ理由に加えて、テストを小さなフィクスチャで
   * 回せるようにするため。本物を指すと `npm test` が `hono-app` の node_modules を要求し、
   * synth のたびに AWS SDK ごと esbuild で束ねる時間を払う。実際のエントリが束ねられるかは
   * CI の `cdk synth` が見る。
   */
  readonly bffEntry: string;

  /**
   * BFF のバンドルが基準にする lock file。
   *
   * WHY 明示するか: `bffEntry` はこのプロジェクトの外（`hono-app`）にある。CDK は
   * lock file を渡されないと cwd から探すので projectRoot が `infra` になり、
   * 「entryPath should be under projectRoot」で synth ごと落ちる。projectRoot は
   * この lock file の置き場所（= workspace ルート）になる。
   */
  readonly bffDepsLockFilePath: string;

  /**
   * BFF が叩くデプロイ済み Runtime の ARN。`readRuntimeArn` で状態ファイルから解決した値。
   *
   * WHY 引数で受けるか: 出所（`agent-app` のデプロイ状態ファイル）を読むのは `bin/` の
   * 仕事にする。スタックがファイルを読むと、テストが実際のデプロイ状態に依存する。
   */
  readonly runtimeArn: string;
}

/**
 * Basic 認証の利用者名。パスワードと違い秘匿する意味が無い（Basic 認証は利用者名も
 * 同じヘッダに平文で載せる）ので、context の口はパスワードだけにする。
 */
export const BASIC_AUTH_USERNAME = 'formecho';

/**
 * viewer request で Basic 認証を掛ける CloudFront Function のコード（#138）。
 *
 * WHY BFF ではなく CloudFront か: BFF の認証ミドルウェアは素通しのままにし、本番の
 * JWT 検証（GSS / Entra）はこのスペックの範囲外（ADR-0014）。ここで守りたいのは
 * #139 で開く Bedrock の課金口を無認証で公開しないことだけなので、front door の
 * 手前で全部落とすのが最も薄い。
 *
 * 資格情報は synth 時に埋め込む。CloudFront Function には環境変数が無く、KeyValueStore
 * を足すのはこの用途には重い。
 */
function basicAuthFunctionCode(password: string): string {
  const expected = `Basic ${Buffer.from(`${BASIC_AUTH_USERNAME}:${password}`).toString('base64')}`;
  return `function handler(event) {
  var request = event.request;
  var authorization = request.headers.authorization;
  if (authorization && authorization.value === '${expected}') {
    // OAC は origin へのリクエストで Authorization を自分の SigV4 署名に差し替える。
    // ビューアの分が残ったまま転送されると S3 が 403 を返す（ADR-0014 が「片方を
    // 足すときにもう片方を壊しやすい」と名指しした組み合わせ）。ここで落としておけば
    // behavior 側の設定に関係なく成立し、#139 で Function を使い回しても崩れない。
    delete request.headers.authorization;
    return request;
  }
  return {
    statusCode: 401,
    statusDescription: 'Unauthorized',
    headers: { 'www-authenticate': { value: 'Basic realm="FormEcho"' } },
  };
}`;
}

/**
 * デプロイ済み検証環境の front door（ADR-0014）。
 *
 * 参照アーキテクチャ（ALB + ECS Fargate）には従わず、CloudFront 単一オリジンで
 * 静的ファイルを配信し、同じディストリビューションの `/api/*` に BFF の Lambda
 * Function URL を繋ぐ（#139）。オリジンが1つなので CORS は発生しない。
 *
 * `agent-app/infra` には相乗りしない。ADR-0010 がその範囲を「`agentcore.json` に
 * 乗らない**エージェント**リソース」と定義しているため。
 */
export class FormEchoFrontDoorStack extends Stack {
  constructor(scope: Construct, id: string, props: FormEchoFrontDoorStackProps) {
    super(scope, id, props);

    // ビルドを忘れたまま deploy すると、古い（あるいは無い）成果物が配信されたうえで
    // デプロイ自体は成功して見える。ここで止めれば理由が読める形で落ちる。
    if (!existsSync(path.join(props.frontendOutDir, 'index.html'))) {
      throw new Error(
        `フロントエンドの成果物が無い: ${props.frontendOutDir}。ビルドとデプロイは \`mise run deploy\` で一緒に走らせること。`
      );
    }

    // 公開しない。CloudFront が OAC（SigV4 署名）で読む唯一の経路にする。
    const bucket = new Bucket(this, 'FrontendBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // 検証環境なので作り直しに寄せる。中身は `next build` からいつでも復元できる。
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // パスワードはリポジトリに置かない（#138）。既定値へフォールバックさせると、
    // 渡し忘れた回に「誰でも知っている資格情報」で公開されるので synth ごと止める。
    // 形は `agent-app/infra` の `runtimeRoleArn` に合わせてある。
    const basicAuthPassword = this.node.tryGetContext('basicAuthPassword') as string | undefined;
    if (!basicAuthPassword) {
      throw new Error(
        'context.basicAuthPassword が無い。デプロイは `FORMECHO_BASIC_AUTH_PASSWORD=... mise run deploy`、' +
          'synth を通すだけなら `npx cdk synth --context basicAuthPassword=...`（#138）。'
      );
    }
    const basicAuth = new CloudFrontFunction(this, 'BasicAuthFunction', {
      code: FunctionCode.fromInline(basicAuthFunctionCode(basicAuthPassword)),
      runtime: FunctionRuntime.JS_2_0,
      comment: 'FormEcho デプロイ済み検証環境の Basic 認証',
    });

    // BFF を Lambda（Node 22 のマネージドランタイム）に載せる（#139）。Function URL を
    // 同じディストリビューションの `/api/*` に繋ぐので、オリジンは1つのままで CORS は
    // 発生せず、パスも透過するので BFF 側のルーティング改修は0行になる。
    const bff = new NodejsFunction(this, 'BffFunction', {
      entry: props.bffEntry,
      depsLockFilePath: props.bffDepsLockFilePath,
      runtime: Runtime.NODEJS_22_X,
      // 既定の128MBだと、AWS SDK を含むバンドルの読み込みでコールドスタートが数秒に伸びる。
      memorySize: 512,
      // 時間予算は触らない（#139）。連鎖は Runtime の自己打ち切り55秒（#125）→ BFF 60秒 →
      // 画面60秒。Runtime が先に諦めるので、ここが60秒でも張り付かない。
      timeout: Duration.seconds(60),
      // 保持期間を設定しないと「無期限」になる。検証環境のログを永久に貯める理由が無い。
      logGroup: new LogGroup(this, 'BffLogGroup', {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        // `FORMECHO_RUNTIME_CLIENT` が不正なら BFF はコールドスタートで落ちる
        // （`hono-app/src/index.ts` が起動時に検証する）。リクエスト時に落とすと
        // 設定ミスが RUNTIME_UNAVAILABLE として出て Runtime 障害と区別が付かない。
        FORMECHO_RUNTIME_CLIENT: 'deployed',
        FORMECHO_RUNTIME_ARN: props.runtimeArn,
      },
      bundling: {
        // AWS SDK を外部化しない。`@aws-sdk/client-bedrock-agentcore` は新しいサービスの
        // クライアントで、マネージドランタイムに同梱される版に頼ると、ランタイムが
        // 更新された回に「動いていたものが解決できない」形で壊れ得る。
        externalModules: [],
      },
    });

    // Runtime を呼ぶ権限。`*` にはしない — 他の Runtime を叩けても得るものが無く、
    // 事故のときに請求だけが増える。エンドポイント修飾子付きの ARN も来るので配下も許す。
    bff.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock-agentcore:InvokeAgentRuntime'],
        resources: [props.runtimeArn, `${props.runtimeArn}/*`],
      })
    );

    // Function URL は公開 DNS 名を持つが公開エンドポイントにはしない。`AWS_IAM` にすると
    // 署名の無いリクエストは 403 になり、CloudFront の OAC だけが SigV4 で署名して通れる。
    // resource policy（OAC 付きオリジンから CDK が自動で張る）は principal を CloudFront の
    // サービスプリンシパルに、`AWS:SourceArn` をこのディストリビューションに絞るので、
    // この CloudFront 以外から BFF を叩く経路が閉じる。
    const bffFunctionUrl = bff.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });

    /**
     * `/api/*` がビューアの `Authorization` を origin へ転送しないための origin request policy。
     *
     * OAC は origin へのリクエストで `Authorization` を自分の SigV4 署名に差し替える。#138 の
     * Basic 認証が読むのは同じヘッダなので、転送すると署名と衝突する。CDK 既定の
     * `AllViewerExceptHostHeader` は `Authorization` を含むため使えない。`Host` も落とす
     * （署名は Function URL のドメインに対して行われる）。
     */
    const apiOriginRequestPolicy = new OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      headerBehavior: OriginRequestHeaderBehavior.denyList('authorization', 'host'),
      queryStringBehavior: OriginRequestQueryStringBehavior.all(),
      cookieBehavior: OriginRequestCookieBehavior.all(),
      comment: 'FormEcho /api/*: ビューアの Authorization を OAC の署名にぶつけない',
    });

    // 単一ルートの SSG なので default root object だけで足りる。ディレクトリ
    // インデックスを書き換える CloudFront Function は要らない。
    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: basicAuth, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: FunctionUrlOrigin.withOriginAccessControl(bffFunctionUrl, {
            // 時間予算の外側に置く（既定は30秒で、Runtime の55秒より手前で切れてしまう）。
            // 60秒は origin response timeout の既定クォータ内なので上限緩和は要らない。
            readTimeout: Duration.seconds(60),
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // BFF は POST で受ける。既定（GET/HEAD）のままだと 405 になる。
          allowedMethods: AllowedMethods.ALLOW_ALL,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginRequestPolicy,
          // 静的ファイルだけ守って `/api/*` を開けると Bedrock の課金口が無認証で公開される。
          // default behavior と同じ Function を使い回す（#138）。
          functionAssociations: [{ function: basicAuth, eventType: FunctionEventType.VIEWER_REQUEST }],
        },
      },
      defaultRootObject: 'index.html',
      comment: 'FormEcho デプロイ済み検証環境',
    });

    // 成果物は人がビルドし、CDK は貼るだけ（synth のたびに Next のビルドを走らせない）。
    new BucketDeployment(this, 'FrontendDeployment', {
      sources: [Source.asset(props.frontendOutDir)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new CfnOutput(this, 'FrontDoorUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
