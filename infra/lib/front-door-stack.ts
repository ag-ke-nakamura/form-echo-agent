import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
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
 * 静的ファイルを配信する。BFF の Lambda Function URL を `/api/*` に足すのはこの
 * スタックの続き（#139）。その behavior にも Basic 認証の Function を付けること。
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

    // 単一ルートの SSG なので default root object だけで足りる。ディレクトリ
    // インデックスを書き換える CloudFront Function は要らない。
    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: basicAuth, eventType: FunctionEventType.VIEWER_REQUEST }],
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
