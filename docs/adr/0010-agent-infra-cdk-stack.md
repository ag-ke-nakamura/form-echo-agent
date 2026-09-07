# agentcore.json に乗らないリソースは `agent-app/infra` の独立 CDK スタックで管理する

- **Status**: accepted
- **Date**: 2026-09-07

Guardrail（案B）は `agentcore.json` の `AgentCoreProjectSpec` にリソースとして宣言する枠が無い（F-11）。`agent-app/agentcore/cdk` は agentcore CLI の完全な生成物で、`agentcore.json` から毎回作り直され `agentcore deploy` のたびに依存バージョンまで書き換わるため、手書きのリソースを混在させる場所として使えない。**agentcore.json のスキーマに乗らないリソースは、`agentcore/cdk` とは独立した `agent-app/infra`（スタック名 `FormEchoAgentInfra`）に、我々が所有する CDK アプリとして書く。** SDK を直叩きする使い捨てスクリプト（`scripts/create-guardrail.ts` はこの ADR により廃止）は state も diff も持たず再実行安全性が無いため採らない。

## Considered Options

- **素の AWS SDK スクリプトを都度書く（現状）**: 依存が増えない一方、drift 検出・再実行安全性が無く、実行漏れ・二重実行に弱い
- **`agent-app/agentcore/cdk` に直接追加する**: 生成物のため次の `agentcore deploy` で消える。採用不可
- **`agent-app/infra` に独立 CDK アプリを新設（採用）**: 保守対象が1つ増えるが、CDK の state・diff・冪等性を得られ、将来 Runtime 実行ロールへの `bedrock:ApplyGuardrail` 権限付与など agentcore.json のスキーマに乗らない他のリソースも同じ場所に積める
- **agentcore CLI が Guardrail をサポートするのを待つ**: 時期不明で Issue #85 を止めてしまう

## Consequences

- Runtime 実行ロールへの `bedrock:ApplyGuardrail` 権限付与（Runtime が F-26 でまだデプロイできないため保留中）は、この `agent-app/infra` スタックから agentcore 管理のロールを参照する形になる見込みだが、その参照方法（cross-stack export か `agentcore status` 等での動的解決か）は未解決のまま残る
- 既存2つの Guardrail はこの CDK では一切 import・参照しない
