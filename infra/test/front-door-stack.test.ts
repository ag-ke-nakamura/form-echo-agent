import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FormEchoFrontDoorStack } from '../lib/front-door-stack';

const FRONTEND_OUT_DIR = path.join(__dirname, 'fixtures', 'frontend-out');

function synth(): Template {
  const stack = new FormEchoFrontDoorStack(new App(), 'TestStack', { frontendOutDir: FRONTEND_OUT_DIR });
  return Template.fromStack(stack);
}

test('フロントエンドの成果物が無いと synth 時にエラーで止まる', () => {
  expect(
    () =>
      new FormEchoFrontDoorStack(new App(), 'TestStack', {
        frontendOutDir: path.join(__dirname, 'fixtures', 'does-not-exist'),
      })
  ).toThrow('mise run deploy');
});

test('S3 バケットは public access を全面的にブロックする', () => {
  synth().hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});

// バケットポリシーに匿名の Allow が1本でも入ると、Block Public Policy に阻まれて
// デプロイが落ちるか、設定を緩めた瞬間に公開される。principal を明示で検査する。
test('バケットポリシーが誰にでも読ませる文を持たない', () => {
  const statements = Object.values(synth().findResources('AWS::S3::BucketPolicy')).flatMap(
    policy => policy.Properties.PolicyDocument.Statement as { Effect: string; Principal?: unknown }[]
  );
  expect(statements.length).toBeGreaterThan(0);
  for (const statement of statements) {
    if (statement.Effect !== 'Allow') continue;
    expect(JSON.stringify(statement.Principal)).not.toContain('"*"');
  }
});

test('CloudFront が OAC で S3 を読む', () => {
  const template = synth();
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({
      OriginAccessControlOriginType: 's3',
      SigningBehavior: 'always',
      SigningProtocol: 'sigv4',
    }),
  });
  // OAC はディストリビューション側の参照と、バケットポリシー側の許可の両方が
  // 揃って初めて読める。片方だけ足しても 403 になる。
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Origins: [Match.objectLike({ OriginAccessControlId: Match.anyValue() })],
    }),
  });
  template.hasResourceProperties('AWS::S3::BucketPolicy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Allow',
          Action: 's3:GetObject',
          Principal: { Service: 'cloudfront.amazonaws.com' },
          Condition: Match.objectLike({ StringEquals: Match.objectLike({ 'AWS:SourceArn': Match.anyValue() }) }),
        }),
      ]),
    }),
  });
});

test('ルートを開くと index.html が返り、HTTP は HTTPS へ回される', () => {
  synth().hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultRootObject: 'index.html',
      DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
    }),
  });
});

// 成果物を貼るのは CDK 側の責務（#137）。ここが消えると、デプロイは成功したまま
// 古い（あるいは空の）バケットが配信され続ける。
test('成果物をバケットへ配置し、CloudFront のキャッシュを飛ばす', () => {
  synth().hasResourceProperties('Custom::CDKBucketDeployment', {
    DistributionPaths: ['/*'],
  });
});
