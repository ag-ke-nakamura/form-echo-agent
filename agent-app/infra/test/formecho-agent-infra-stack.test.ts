import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FormEchoAgentInfraStack } from '../lib/formecho-agent-infra-stack';

const TEST_RUNTIME_ROLE_ARN = 'arn:aws:iam::123456789012:role/TestRuntimeRole';
const TEST_RUNTIME_ARN = 'arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/Test-abc123';

function synth(): Template {
  const app = new App({
    context: { runtimeRoleArn: TEST_RUNTIME_ROLE_ARN, runtimeArn: TEST_RUNTIME_ARN },
  });
  const stack = new FormEchoAgentInfraStack(app, 'TestStack');
  return Template.fromStack(stack);
}

test('context.runtimeRoleArn が無いと synth 時にエラーで止まる', () => {
  const app = new App();
  expect(() => new FormEchoAgentInfraStack(app, 'TestStack')).toThrow('runtimeRoleArn');
});

test('context.runtimeArn が無いと synth 時にエラーで止まる（#213）', () => {
  const app = new App({ context: { runtimeRoleArn: TEST_RUNTIME_ROLE_ARN } });
  expect(() => new FormEchoAgentInfraStack(app, 'TestStack')).toThrow('runtimeArn');
});

test('Runtime 実行ロールに bedrock:InvokeGuardrailChecks を許可するインラインポリシーが付く', () => {
  synth().hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Allow',
          Action: 'bedrock:InvokeGuardrailChecks',
          Resource: '*',
        }),
      ]),
    }),
    Roles: [TEST_RUNTIME_ROLE_ARN.split('/').pop()],
  });
});

/*
  コンソールの「Tracing」トグルに当たる配送（#213）。**3つが揃って初めて効く**ので、
  1つでも欠けると「設定したつもりで何も届かない」状態になる。
*/
test('Runtime の span を X-Ray へ配送する設定が3つ揃う（#213）', () => {
  const template = synth();

  template.hasResourceProperties('AWS::Logs::DeliverySource', {
    ResourceArn: TEST_RUNTIME_ARN,
    LogType: 'TRACES',
  });

  // X-Ray 宛ては宛先 ARN を持たず型だけで決まる。設定を足すと検証で落ちる。
  template.hasResourceProperties('AWS::Logs::DeliveryDestination', {
    DeliveryDestinationType: 'XRAY',
  });

  template.resourceCountIs('AWS::Logs::Delivery', 1);
});

// 案A（`InvokeGuardrailChecks`）はリソースレスAPIなので、このスタックが Guardrail
// リソースを持つのは案Bを復活させたときだけ。
test('案Bの Guardrail リソースを復活させない（ADR-0013）', () => {
  const template = synth();
  template.resourceCountIs('AWS::Bedrock::Guardrail', 0);
  template.resourceCountIs('AWS::Bedrock::GuardrailVersion', 0);
});
