import { CfnGuardrail, CfnGuardrailVersion } from 'aws-cdk-lib/aws-bedrock';
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { guardrailProps } from './guardrail-config';

/**
 * `agentcore.json` のスキーマに乗らないリソースを管理するスタック（ADR-0010）。
 *
 * `agent-app/agentcore/cdk` は agentcore CLI の生成物で `agentcore deploy` の
 * たびに作り直されるため、手書きのリソースの置き場にはできない。ここは我々が
 * 所有する独立の CDK アプリで、既存2つの Guardrail は一切 import・参照しない。
 */
export class FormEchoAgentInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const guardrail = new CfnGuardrail(this, 'Guardrail', guardrailProps());

    // DRAFT のまま使わず、比較のために固定したバージョンを1つ切る。
    const guardrailVersion = new CfnGuardrailVersion(this, 'GuardrailVersion', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: '#43 の実測比較用の初回バージョン',
    });

    // 案B（FORMECHO_GUARDRAIL_APPLY_GUARDRAIL=true）が読む
    // FORMECHO_GUARDRAIL_ID / FORMECHO_GUARDRAIL_VERSION の値。
    new CfnOutput(this, 'GuardrailIdOutput', {
      value: guardrail.attrGuardrailId,
    });
    new CfnOutput(this, 'GuardrailVersionOutput', {
      value: guardrailVersion.attrVersion,
    });
  }
}
