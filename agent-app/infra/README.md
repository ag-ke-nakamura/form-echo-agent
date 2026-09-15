# agent-app/infra

`agentcore.json`（`AgentCoreProjectSpec`）のスキーマに乗らない AgentCore 関連リソースを、
我々が所有する独立の CDK アプリとして管理する（ADR-0010）。`agent-app/agentcore/cdk` は
agentcore CLI の生成物で `agentcore deploy` のたびに作り直されるため、ここには置けない。

持つのは Runtime 実行ロールへの `bedrock:InvokeGuardrailChecks` 許可（ADR-0010）だけ。

## 構成

- `bin/infra.ts` — エントリポイント。`FormEchoAgentInfraStack` を1つ作る。
- `lib/formecho-agent-infra-stack.ts` — スタック本体。
- `scripts/sync-cdk-context.ts` — `agentcore` 側の ARN を `cdk.json` の `context` に
  キャッシュするスクリプト（実行ロールとRuntime 本体の2つ）。
- `test/` — スタックの synth 結果を検証する単体テスト。

## コマンド

- `npm run build` — TypeScript をコンパイル
- `npm run test` — 単体テスト
- `npm run sync-cdk-context` — `agentcore` 側の ARN を `cdk.json` に書き込む
- `npx cdk diff` — デプロイ済みスタックとの差分
- `npx cdk deploy` — デプロイ

## ARN のキャッシュ

このスタックは `agentcore` が作ったリソースを2つ参照する。**どちらもデプロイして初めて
決まる**ので、値を埋め込まず `cdk.json` の `context` 越しに読む。

| context          | 参照先             | 用途                               |
| ---------------- | ------------------ | ---------------------------------- |
| `runtimeRoleArn` | Runtime 実行ロール | Guardrail 用の IAM 権限を付与する  |
| `runtimeArn`     | Runtime 本体       | トレースの配送元として指す（#213） |

`agentcore/cdk` は生成物で export を持たないため cross-stack 参照は使えない（ADR-0010）。
代わりに `agentcore status --json` の出力から取り出してキャッシュする。synth のたびに
叩かないのは、CDK 自身が `cdk.context.json` で context provider の解決結果をキャッシュする
のと同じ発想。

**Runtime を再デプロイして ARN が変わったら `npm run sync-cdk-context` を再実行すること。**
どちらかが欠けた状態で synth すると、このスクリプトの実行を促すエラーで止まる。

## デプロイ前に必ず確認する

**このスタックの `cdk deploy` は共用アカウントの実際の AWS リソースを作る・消す。**
実行前に必ずユーザーへ確認を取ること。既存2つの Guardrail はこの CDK では
一切 import・参照しない。

デプロイ後:

- Runtime からの `bedrock:InvokeGuardrailChecks` 呼び出しが引き続き成功することを確認したら、
  応急処置として手動で付けたインラインポリシー `InvokeGuardrailChecks`
  （ロール `AgentCore-FormEcho-defaul-ApplicationAgentFormEchoA-0lN6LVXEiBWj`）を削除する。
  同じ許可を二重に残さない。
