import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
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
 * デプロイ済み検証環境の front door（ADR-0014）。
 *
 * 参照アーキテクチャ（ALB + ECS Fargate）には従わず、CloudFront 単一オリジンで
 * 静的ファイルを配信する。BFF の Lambda Function URL を `/api/*` に足すのも、
 * Basic 認証の CloudFront Function を付けるのもこのスタックの続き（#138・#139）。
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

    // 単一ルートの SSG なので default root object だけで足りる。ディレクトリ
    // インデックスを書き換える CloudFront Function は要らない。
    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
