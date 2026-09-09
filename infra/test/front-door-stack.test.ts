import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BASIC_AUTH_USERNAME, FormEchoFrontDoorStack } from '../lib/front-door-stack';

const FRONTEND_OUT_DIR = path.join(__dirname, 'fixtures', 'frontend-out');
// テスト用の作り話であって秘密ではない。識別子が `PASSWORD` で終わると
// betterleaks の generic-password に引っかかるので明示的に許可する。
const PASSWORD = 'test-password'; // betterleaks:allow

function synth(context: Record<string, unknown> = { basicAuthPassword: PASSWORD }): Template {
  const app = new App({ context });
  const stack = new FormEchoFrontDoorStack(app, 'TestStack', { frontendOutDir: FRONTEND_OUT_DIR });
  return Template.fromStack(stack);
}

test('フロントエンドの成果物が無いと synth 時にエラーで止まる', () => {
  expect(
    () =>
      new FormEchoFrontDoorStack(new App({ context: { basicAuthPassword: PASSWORD } }), 'TestStack', {
        frontendOutDir: path.join(__dirname, 'fixtures', 'does-not-exist'),
      })
  ).toThrow('mise run deploy');
});

// パスワードはリポジトリに入れず synth 時に context で注入する（#138）。
test('context にパスワードが無いと synth 時にエラーで止まる', () => {
  expect(() => synth({})).toThrow('basicAuthPassword');
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

// #138: Basic 認証は CloudFront Function（viewer request）で掛ける。BFF の認証
// ミドルウェアは素通しのままなので、ここが外れると #139 で足す Bedrock の課金口が
// 無認証で公開される。
describe('Basic 認証の CloudFront Function', () => {
  // synth は重いので1度だけ。実際にデプロイされるコードをそのまま評価する
  // （テンプレートの形だけ見ていると、資格情報の比較を取り違えても緑のままになる）。
  let functionCode: string;
  let handler: Handler;

  type ViewerRequestResult = { statusCode?: number; headers?: Record<string, { value: string }> };
  type Handler = (event: { request: { headers: Record<string, { value: string }> } }) => ViewerRequestResult;

  beforeAll(() => {
    const functions = Object.values(synth().findResources('AWS::CloudFront::Function'));
    expect(functions).toHaveLength(1);
    functionCode = functions[0].Properties.FunctionCode as string;
    handler = new Function(`${functionCode}; return handler;`)() as Handler;
  });

  // viewer-request 以外（viewer-response など）に付くと、認証を経ずに本文が返る。
  // どの Function か（`Match.anyValue()`）まで見る。#139 で `/api/*` の behavior が
  // 増えたとき、association が別の Function に化けても気付けるようにする。
  test('default behavior の viewer-request に付いている', () => {
    const template = synth();
    const [logicalId] = Object.keys(template.findResources('AWS::CloudFront::Function'));
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          FunctionAssociations: [
            { EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': [logicalId, 'FunctionARN'] } },
          ],
        }),
      }),
    });
  });

  test('viewer request 用のランタイムで動く', () => {
    synth().hasResourceProperties('AWS::CloudFront::Function', {
      FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }),
    });
  });

  const requestWith = (credentials: string) =>
    handler({ request: { headers: { authorization: { value: credentials } } } });

  test('正しい資格情報ならリクエストを通す', () => {
    const request = { headers: { authorization: { value: `Basic ${btoa(`${BASIC_AUTH_USERNAME}:${PASSWORD}`)}` } } };
    expect(handler({ request })).toBe(request);
  });

  // ADR-0014 が「片方を足すときにもう片方を壊しやすい」と名指しした組み合わせ。
  // ビューアの Authorization が残ったまま origin へ行くと、OAC の SigV4 署名と衝突して
  // S3 が 403 を返す。behavior の設定ではなく Function 側で落として構造的に潰す。
  test('通したリクエストから Authorization を落とす', () => {
    expect(requestWith(`Basic ${btoa(`${BASIC_AUTH_USERNAME}:${PASSWORD}`)}`)).toEqual({ headers: {} });
  });

  test('誤ったパスワードは 401 で止める', () => {
    expect(requestWith(`Basic ${btoa(`${BASIC_AUTH_USERNAME}:wrong-password`)}`).statusCode).toBe(401);
  });

  test('Authorization ヘッダが無ければ 401 とチャレンジを返す', () => {
    const response = handler({ request: { headers: {} } });
    expect(response.statusCode).toBe(401);
    expect(response.headers?.['www-authenticate'].value).toMatch(/^Basic realm=/);
  });

  // 平文が入ると CI の secret scan と正面衝突する。base64 は難読化であって秘匿では
  // ないが、テンプレートに載るのは synth の産物であってリポジトリの中身ではない。
  test('コードにパスワードの平文を含まない', () => {
    expect(functionCode).not.toContain(PASSWORD);
  });
});
