# agent-app/infra

`agentcore.json`（`AgentCoreProjectSpec`）のスキーマに乗らない AgentCore 関連リソースを、
我々が所有する独立の CDK アプリとして管理する（ADR-0010）。`agent-app/agentcore/cdk` は
agentcore CLI の生成物で `agentcore deploy` のたびに作り直されるため、ここには置けない。

現時点で持つのは Runtime 実行ロールへの `bedrock:InvokeGuardrailChecks` 許可（ADR-0010）と、
消費者のいなくなった Guardrail リソース（案Bのために作った。削除は #126）。

## 構成

- `bin/infra.ts` — エントリポイント。`FormEchoAgentInfraStack` を1つ作る。
- `lib/formecho-agent-infra-stack.ts` — スタック本体。
- `lib/guardrail-config.ts` — Guardrail の設定（旧 `scripts/create-guardrail.ts` から移植）。
- `scripts/cache-runtime-role-arn.ts` — Runtime 実行ロールの ARN を `cdk.json` の
  `context.runtimeRoleArn` にキャッシュするスクリプト。
- `test/` — スタックの synth 結果を検証する単体テスト。

## コマンド

- `npm run build` — TypeScript をコンパイル
- `npm run test` — 単体テスト
- `npm run cache-runtime-role-arn` — Runtime 実行ロールの ARN を `cdk.json` に書き込む
- `npx cdk diff` — デプロイ済みスタックとの差分
- `npx cdk deploy` — デプロイ

## Runtime 実行ロールの ARN キャッシュ

`FormEchoAgentInfraStack` は Runtime 実行ロール（`agentcore` が管理し、この CDK からは
生成しない）に IAM 権限を付与するため、`iam.Role.fromRoleArn()` でそのロールを参照する。
ARN は synth のたびに解決するのではなく `cdk.json` の `context.runtimeRoleArn` に
キャッシュしておき、CDK はそこから読む。

**Runtime を再デプロイしてロールが変わったら `npm run cache-runtime-role-arn` を
再実行すること。**（agent-app/ で `agentcore status --json` を叩いて `roleArn` を取り出し、
`cdk.json` を書き換える。）`context.runtimeRoleArn` が無い状態で synth すると、このスクリプトの
実行を促すエラーで止まる。

## デプロイ前に必ず確認する

**このスタックの `cdk deploy` は共用アカウントに実際の AWS リソースを作る。**
実行前に必ずユーザーへ確認を取ること。既存の2つの Guardrail はこの CDK では
一切 import・参照しない。

デプロイ後:

- `GuardrailIdOutput` / `GuardrailVersionOutput` の CFN 出力を読むコードはもう無い
  （案Bを畳んだ。ADR-0013）。Guardrail リソースを定義ごと消すのは #126。
- Runtime からの `bedrock:InvokeGuardrailChecks` 呼び出しが引き続き成功することを確認したら、
  応急処置として手動で付けたインラインポリシー `InvokeGuardrailChecks`
  （ロール `AgentCore-FormEcho-defaul-ApplicationAgentFormEchoA-0lN6LVXEiBWj`）を削除する。
  同じ許可を二重に残さない。
