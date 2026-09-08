# FormEchoAgent

FormEcho の AgentCore Runtime。BFF（`hono-app`）から自然文・構造化入力を受け取り、
[Strands Agents SDK](https://strandsagents.com/) 経由で Bedrock のモデルを呼び、
Structured Output で構造化データを返す。Guardrail チェック（プロンプト
インジェクション・個人情報のブロック）もこの Runtime に実装している。

`agent-app/` 配下（`agentcore` CLI が管理するプロジェクトルート）にあるため、
CLI コマンドは `agent-app/` で実行する。この Runtime 自体のコードはここ
`agent-app/app/FormEchoAgent/` にある。

## 構成

| パス | 役割 |
| --- | --- |
| `main.ts` | エントリポイント。`BedrockAgentCoreApp` への配線と起動だけを持つ |
| `invocation/` | invocation のロジック本体。`handler.ts`（リクエスト検査・エラー写像）→ `invoke-task.ts`（Guardrail・モデル呼び出し・Web検索予算）→ `domain-agent.ts`（Agent のセッションキャッシュ）→ `structured-output.ts`（Structured Output の再試行） |
| `guardrail/` | Guardrail チェック。`InvokeGuardrailChecks` と日本固有 PII の正規表現チェックの2つを常時実行し、`load.ts` がまとめる（ADR-0013） |
| `tools/` | ドメインエージェントに渡すツール（Web 検索。交通ICドメインのみ） |
| `model/` | モデルの選択（Bedrock / テスト用 fake） |
| `skills/` | taskId ごとの Skill データ（`registry.ts` が束ねる。Strands の `AgentSkills`、ADR-0012） |
| `contracts` | リポジトリ直下 `contracts/` への symlink。入出力契約の正典 |
| `tests/` | vitest のテストとテスト用の足場 |

## 開発

`npm run dev` / `npm start` を直接使わず、`agentcore dev` / `agentcore deploy`
経由で操作する（プロセス単体をデバッグする場合を除く）。3プロセスまとめて
起動するならリポジトリルートで `mise run dev`。

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | `tsx watch main.ts`（`agentcore dev` の中身） |
| `npm run build` | `tsc`（`dist/` に出力。テストと `scripts/` は含まない） |
| `npm run typecheck` | `tsc -p tsconfig.test.json`（テストと `scripts/` も含めて型検査） |
| `npm run test` | `vitest run` |
| `npm run lint` / `npm run format` | biome |

テストの書き方の作法は `../../.claude/rules/formecho-agent-testing.md`。

## 環境変数

すべて `config.ts` が読む。再ビルドせずに切り替えられる。

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP サーバのポート |
| `FORMECHO_MODEL` | `sonnet` | 使用モデル。`sonnet` / `haiku`（`jp.` プレフィックスの推論プロファイルのみ） / `fake`（Bedrock に接続しない。テスト用） |
| `FORMECHO_WEB_SEARCH_GATEWAY_URL` | 未設定＝Web検索なし | 交通ICドメインが使う AgentCore Gateway の MCP エンドポイント。ホスト名が `ap-northeast-1` でなければ起動時に落ちる |
| `FORMECHO_GUARDRAIL_STRATEGY` | 未設定 | **テスト専用。** `fake` にすると `InvokeGuardrailChecks` の呼び先を Bedrock に接続しない fake に差し替える（正規表現チェックは純関数なので対象外） |

Guardrail の経路（`InvokeGuardrailChecks` + 日本固有 PII 検知）は常時有効で、
env で切り替えられない。しきい値も `config.ts` の定数（ADR-0013）。

Guardrail の設計判断・IAM 権限・Guardrail リソース運用の詳細は
`../../.claude/rules/agent-app.md` を参照。
