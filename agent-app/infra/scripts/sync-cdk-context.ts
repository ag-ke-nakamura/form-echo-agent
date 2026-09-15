import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * `agentcore` が作ったリソースの ARN を `cdk.json` の `context` へ同期する。
 *
 * このスタックは隣のスタック（`agentcore/cdk`。CLI の生成物）が作ったリソースを
 * 参照するが、**あちらは生成物で export を持たないため cross-stack 参照が使えない**
 * （ADR-0010）。代わりに `agentcore status --json` から ARN を取り出してここへ書き、
 * スタックは `node.tryGetContext()` で読む。
 *
 * 同期であって一度きりではない。**Runtime を作り直すと ARN ごと変わる**ので、
 * その都度これを実行して合わせ直す運用になっている。synth のたびに `agentcore status`
 * を叩かないのは、CDK 自身が `cdk.context.json` で context provider の解決結果を
 * 持つのと同じ考え方。
 *
 * `npm run sync-cdk-context` から実行する前提（npm run はこの package.json の
 * ディレクトリを cwd にする）。`agentcore status` は agent-app/ 内でしか実行できない
 * （CLI がカレントディレクトリをプロジェクトルートとして扱うため）。
 *
 * `agentcore` は実際の cwd よりも npm が設定する `INIT_CWD`（npm run の呼び出し元
 * ディレクトリ）を優先して見るため、`npm run` 経由だと `cwd` オプションを渡しても
 * ここが agent-app/infra のままだと誤検知する。子プロセスの env からは消しておく。
 */
const INFRA_DIR = process.cwd();
const AGENT_APP_DIR = path.join(INFRA_DIR, '..');
const CDK_JSON_PATH = path.join(INFRA_DIR, 'cdk.json');
const envWithoutInitCwd = { ...process.env };
delete envWithoutInitCwd.INIT_CWD;

/**
 * 実行ロールと Runtime 本体、2つの ARN を取る。
 *
 * **どちらもデプロイして初めて決まる**（Runtime を作り直すと ID ごと変わる）ので、
 * このスタックは値を埋め込まずキャッシュ越しに参照する。トレースの配送（#213）は
 * Runtime の ARN を配送元として指すため、ロールだけでは足りない。
 */
function fetchRuntimeArns(): { roleArn: string; runtimeArn: string } {
  const output = execFileSync('agentcore', ['status', '--json'], {
    cwd: AGENT_APP_DIR,
    encoding: 'utf-8',
    env: envWithoutInitCwd,
  });
  const status = JSON.parse(output);
  const runtimes = status?.deployedState?.targets?.default?.resources?.runtimes;
  const found = runtimes?.FormEchoAgent;
  for (const key of ['roleArn', 'runtimeArn'] as const) {
    if (typeof found?.[key] !== 'string' || found[key].length === 0) {
      throw new Error(
        `agentcore status --json の deployedState.targets.default.resources.runtimes.FormEchoAgent.${key} が見つからない: ${output}`
      );
    }
  }
  return { roleArn: found.roleArn, runtimeArn: found.runtimeArn };
}

function writeToCdkJson(arns: { roleArn: string; runtimeArn: string }): void {
  const cdkJson = JSON.parse(readFileSync(CDK_JSON_PATH, 'utf-8'));
  cdkJson.context.runtimeRoleArn = arns.roleArn;
  cdkJson.context.runtimeArn = arns.runtimeArn;
  writeFileSync(CDK_JSON_PATH, JSON.stringify(cdkJson, null, 2) + '\n');
  execFileSync('npm', ['exec', '--', 'prettier', '--write', 'cdk.json'], { cwd: INFRA_DIR });
}

const arns = fetchRuntimeArns();
writeToCdkJson(arns);
console.log(`cdk.json の context を更新した: ${arns.roleArn} / ${arns.runtimeArn}`);
