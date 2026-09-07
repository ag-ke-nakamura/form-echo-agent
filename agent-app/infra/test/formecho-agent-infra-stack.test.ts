import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FormEchoAgentInfraStack } from '../lib/formecho-agent-infra-stack';

function synth(): Template {
  const app = new App();
  const stack = new FormEchoAgentInfraStack(app, 'TestStack');
  return Template.fromStack(stack);
}

test('Guardrail は Classic Tier・新規名前で作られる', () => {
  synth().hasResourceProperties('AWS::Bedrock::Guardrail', {
    Name: 'FormEchoGuardrail',
    ContentPolicyConfig: Match.objectLike({
      ContentFiltersTierConfig: { TierName: 'CLASSIC' },
    }),
  });
});

test('マイナンバーの正規表現チェックが my_number という名前で登録される', () => {
  synth().hasResourceProperties('AWS::Bedrock::Guardrail', {
    SensitiveInformationPolicyConfig: Match.objectLike({
      RegexesConfig: Match.arrayWith([
        Match.objectLike({
          Name: 'my_number',
          Pattern: String.raw`\d{4}-?\d{4}-?\d{4}`,
          Action: 'BLOCK',
        }),
      ]),
    }),
  });
});

test('ADDRESS / NAME 等の汎用 PII カテゴリは含めない（F-06 の誤検知回避）', () => {
  const piiEntities = synth().findResources('AWS::Bedrock::Guardrail')['Guardrail'].Properties
    .SensitiveInformationPolicyConfig.PiiEntitiesConfig as Array<{
    Type: string;
  }>;
  const types = piiEntities.map(entity => entity.Type);
  expect(types).not.toEqual(expect.arrayContaining(['ADDRESS', 'NAME', 'EMAIL', 'PHONE']));
});

test('GuardrailVersion が Guardrail を参照して1つ切られる', () => {
  synth().hasResourceProperties('AWS::Bedrock::GuardrailVersion', {
    GuardrailIdentifier: Match.anyValue(),
  });
  synth().resourceCountIs('AWS::Bedrock::GuardrailVersion', 1);
});
