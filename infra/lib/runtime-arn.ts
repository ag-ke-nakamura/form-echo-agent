import { readFileSync } from 'node:fs';

/**
 * デプロイ済み Runtime の ARN を `agent-app` のデプロイ状態ファイルから読む（#139）。
 *
 * WHY context に書かないか: `mise.toml` の `dev:deployed` が既に同じ ARN を持っている。
 * CDK 側にも手写しすると、デプロイ先を張り替えたときに片方だけ古くなり、しかも
 * 「デプロイ済み環境からは古い Runtime が答える」という形で表に出る。`agentcore deploy`
 * の結果としてコミットされているファイルを唯一の出所にする。
 *
 * `agent-app/infra` の `cache-runtime-role-arn` とは経路が違う。あちらは `agentcore status`
 * を叩いて cdk.json へ焼き付ける（Guardrail を張る相手の role ARN が要るのはデプロイ時
 * だけで、synth を CI で回すのに AWS 資格情報を要求したくない）。こちらは同じ状態ファイルを
 * 直接読むので、CLI も資格情報も要らない。
 */
export function readRuntimeArn(deployedStatePath: string): string {
  const state = JSON.parse(readFileSync(deployedStatePath, 'utf-8'));
  const arn = state?.targets?.default?.resources?.runtimes?.FormEchoAgent?.runtimeArn;
  if (typeof arn !== 'string' || !arn.startsWith('arn:')) {
    throw new Error(
      `${deployedStatePath} の targets.default.resources.runtimes.FormEchoAgent.runtimeArn が読めない。` +
        '`agentcore deploy` を済ませ、その結果をコミットしてから deploy すること（#139）。'
    );
  }
  return arn;
}
