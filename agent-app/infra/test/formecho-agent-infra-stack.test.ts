import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FormEchoAgentInfraStack } from '../lib/formecho-agent-infra-stack';

const TEST_RUNTIME_ROLE_ARN = 'arn:aws:iam::123456789012:role/TestRuntimeRole';

function synth(): Template {
  const app = new App({ context: { runtimeRoleArn: TEST_RUNTIME_ROLE_ARN } });
  const stack = new FormEchoAgentInfraStack(app, 'TestStack');
  return Template.fromStack(stack);
}

test('context.runtimeRoleArn が無いと synth 時にエラーで止まる', () => {
  const app = new App();
  expect(() => new FormEchoAgentInfraStack(app, 'TestStack')).toThrow('runtimeRoleArn');
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

// 案A（`InvokeGuardrailChecks`）はリソースレスAPIなので、このスタックが Guardrail
// リソースを持つのは案Bを復活させたときだけ。
test('案Bの Guardrail リソースを復活させない（ADR-0013）', () => {
  const template = synth();
  template.resourceCountIs('AWS::Bedrock::Guardrail', 0);
  template.resourceCountIs('AWS::Bedrock::GuardrailVersion', 0);
});
