# FormEcho

自然言語入力を AI で解析し、画面フォームの構成に合わせた構造化データを返す仕組みの検証環境。参照アーキテクチャ（AgentCore Runtime を BFF から分離する構成）を実際に動かして、プロンプト・Guardrail の精度と本番向けサンプルコードを得ることを目的とする。

## Language

### エージェント基盤

**Runtime**:
AgentCore Runtime。デプロイの単位であり、この検証環境には1つだけ存在する。
_Avoid_: エージェント（単独で使うと曖昧）

**ドメインエージェント**:
1つのドメイン（交通IC、会議ロジ）に対応する Strands の `Agent` インスタンス。ドメイン間で協調しない。
_Avoid_: エージェント（単独）、サブエージェント、コラボレーター

**Skill**:
`SKILL.md` 1ファイル。ドメインエージェントが持つ振る舞いの単位で、Strands の `AgentSkills` がロードする。
_Avoid_: プロンプト、タスク、テンプレート

**Agent Skills（ハーネス）**:
このリポジトリの `.claude/` が使う Claude Code 側の仕組み。上の Skill とは無関係で、同じ語で呼ぶと必ず混乱する。
_Avoid_: Skill（修飾なし）

**taskId**:
BFF から Runtime へ渡すルーティングキー。どのドメインエージェントを使うかを決める。
_Avoid_: 機能ID、タスク名、機能名

**BFF**:
`hono-app`。入力検証と Runtime 呼び出しを担う層。
_Avoid_: API、バックエンド、プロキシ

### 入出力

**出力契約**:
Runtime が返す構造化データのスキーマ。`contracts/` に置く Zod スキーマが正典。
_Avoid_: レスポンス型、スキーマ（単独）、Structured Output（機能名であって契約ではない）

**Guardrail チェック**:
`InvokeGuardrailChecks` API による入力・出力の検査。`contentFilter` / `promptAttack` / `sensitiveInformation` の3種からなる。
_Avoid_: ガードレール（リソースとしての Guardrail と紛れる）、入力検証（BFF の長さ・形式チェックと紛れる）

**severityScore**:
コンテンツがチェック基準にどれだけ強く該当するかの度合い。`contentFilter` と `promptAttack` が返す。モデルの確信度ではない。
_Avoid_: 信頼度、確度

**confidenceScore**:
その PII が存在するというモデルの確信度。`sensitiveInformation` が返す。
_Avoid_: スコア（単独。severityScore と意味が違う）

**非AI経路**:
AI を使わずにフォームを埋めきれる経路。すべての AI 機能に対して確保される。
_Avoid_: 手動入力（フォールバックとしての手動入力と、初めから AI を使わない選択の両方を指してしまう）
