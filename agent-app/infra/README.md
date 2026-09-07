# agent-app/infra

`agentcore.json`（`AgentCoreProjectSpec`）のスキーマに乗らない AgentCore 関連リソースを、
我々が所有する独立の CDK アプリとして管理する（ADR-0010）。`agent-app/agentcore/cdk` は
agentcore CLI の生成物で `agentcore deploy` のたびに作り直されるため、ここには置けない。

現時点で持つのは Guardrail（案B、`ApplyGuardrail` が参照するリソース）1つ。

## 構成

- `bin/infra.ts` — エントリポイント。`FormEchoAgentInfraStack` を1つ作る。
- `lib/formecho-agent-infra-stack.ts` — スタック本体。
- `lib/guardrail-config.ts` — Guardrail の設定（旧 `scripts/create-guardrail.ts` から移植）。
- `test/` — スタックの synth 結果を検証する単体テスト。

## コマンド

- `npm run build` — TypeScript をコンパイル
- `npm run test` — 単体テスト
- `npx cdk diff` — デプロイ済みスタックとの差分
- `npx cdk deploy` — デプロイ

## デプロイ前に必ず確認する

**このスタックの `cdk deploy` は共用アカウントに実際の AWS リソースを作る。**
実行前に必ずユーザーへ確認を取ること。既存の2つの Guardrail はこの CDK では
一切 import・参照しない。

デプロイ後、`GuardrailIdOutput` / `GuardrailVersionOutput` の CFN 出力を
`FORMECHO_GUARDRAIL_ID` / `FORMECHO_GUARDRAIL_VERSION` に設定する
（`agent-app/app/FormEchoAgent/config.ts` の `resolveGuardrailResource`）。
