import { Policy, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { Stack, type StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * `agentcore.json` のスキーマに乗らないリソースを管理するスタック（ADR-0010）。
 *
 * `agent-app/agentcore/cdk` は agentcore CLI の生成物で `agentcore deploy` の
 * たびに作り直されるため、手書きのリソースの置き場にはできない。ここは我々が
 * 所有する独立の CDK アプリで、既存2つの Guardrail は一切 import・参照しない。
 *
 * 乗っているのは Runtime 実行ロールへの権限付与だけだが、それを `agentcore.json` で
 * 宣言できないことは変わらないので、スタック自体は残る（ADR-0013）。
 */
export class FormEchoAgentInfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const runtimeRoleArn = this.node.tryGetContext('runtimeRoleArn') as string | undefined;
    if (!runtimeRoleArn) {
      throw new Error(
        'context.runtimeRoleArn が cdk.json に無い。`npm run cache-runtime-role-arn` を実行してから再実行すること（ADR-0010）。'
      );
    }
    const runtimeRole = Role.fromRoleArn(this, 'RuntimeRole', runtimeRoleArn, { mutable: true });
    // 案A（InvokeGuardrailChecks）はリソースレスAPIのため Resource: "*"（F-08）。
    // 案B（ApplyGuardrail）は採用しないため対象外（ADR-0013 で案A + 日本固有 PII
    // 検知の1本に畳んだ。「未デプロイのため」という当初の理由はもう当たらない）。
    new Policy(this, 'InvokeGuardrailChecksPolicy', {
      roles: [runtimeRole],
      statements: [new PolicyStatement({ actions: ['bedrock:InvokeGuardrailChecks'], resources: ['*'] })],
    });
  }
}
