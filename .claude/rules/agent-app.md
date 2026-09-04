---
paths:
  - "agent-app/**/*"
---

# agent-app（AgentCore）

## 生成物と我々のコードの境界

- `agent-app/agentcore/agentcore.json` がデプロイ対象のソース・オブ・トゥルース
- **`agent-app/AGENTS.md` にスキーマと CLI リファレンスがある。`agentcore.json` や AgentCore
  リソースを触る前に読むこと**
- `agent-app/AGENTS.md` と `agent-app/README.md` は CLI の生成物。`render()` が `copyFile` で
  上書きするため、我々の内容を書かない
- `agent-app/agentcore/cdk` も生成物。依存の固定と dependabot の扱いは
  `.claude/rules/agentcore-cdk.md`

## Runtime 本体

`agent-app/app/FormEchoAgent/` がデプロイされるエージェント本体（Strands SDK +
`bedrock-agentcore`、エントリ `main.ts`）。

- **`main.ts` は `BedrockAgentCoreApp` への配線と起動だけを持ち、invocation のロジックは
  `invocation/` にある**（シームは `invocation/invoke-task.ts` の `invokeTask`）
- **`npm run dev` / `npm start` を直接使わず `agentcore dev` / `agentcore deploy` 経由で操作する**
  （プロセス単体をデバッグする場合を除く）
- **ツールはドメインごとの表（`tools/load.ts`）から引く。** 交通ICだけが Web 検索
  （AgentCore Gateway、`FORMECHO_WEB_SEARCH_GATEWAY_URL`）を持ち、**会議ロジには渡さない** —
  後回しではなくそもそも不要（F-22）で、渡さないこと自体が #46 の成果に含まれる。
  検索回数の上限はリクエスト単位なので `AsyncLocalStorage`（`tools/web-search.ts`）で持ち、
  `invokeTask` が全体を包む。**`agent.invoke` ごとの `invocationState` では Structured Output の
  作り直しで予算が戻ってしまう**
- **相対的な日付・時刻は system prompt の「基準時刻」で解決する。時刻取得のツールを渡さない。**
  `invocation/system-prompt.ts` が JST の現在時刻を毎回埋め、`domain-agent.ts` がキャッシュ済み
  Agent にも貼り直す（system prompt は生成時に固定されるため、貼り直さないと追加の指示が初回の
  時刻から数える）。ツールでも解けるが、モデルが呼ばずに「現在時刻が分かりません」と答える失敗の
  余地が残る上、会議ロジにツールを1つも渡していないこと（#36）を崩す
- **リクエストの検査を `BedrockAgentCoreApp` の `requestSchema` に任せない。** bedrock-agentcore
  0.3.0 は検査に落ちたとき 400 の本文を Content-Type 指定なしで送るが、呼び出し側が
  `Accept: text/event-stream` だと `@fastify/sse` が応答を握っており fastify が object を拒否する
  （`FST_ERR_REP_INVALID_PAYLOAD_TYPE`）。結果、**本文の無い 500** になって原因が伝わらない。
  `invocation/handler.ts` の中で `aiTaskRequestSchema` を回すこと

## CLI の既知の穴

- **`agentcore deploy` は通る**（#46 で Gateway を張った）。`aws-targets.json` は CLI が自分で
  埋める（`default` / 122664578519 / ap-northeast-1）ので、「デプロイ先が未設定」ではない
- **ただし `runtimes` を含む synth は失敗する。** CodeZip の esbuild が `contracts/` の symlink
  越しに `zod` を解決できない（`docs/reference-doc-fixes.md` F-26。`agentcore package` が
  失敗する理由も現在はこれで、esbuild のバイナリの件ではない）。**Runtime を伴わない
  リソースだけなら deploy できる** — #46 は `runtimes` を一時的に空にして Gateway だけを
  張り、`agentcore.json` は元に戻してある（**Runtime は未デプロイのまま**）
- **CLI と `agentcore/cdk` の `@aws/agentcore-cdk` はバージョンが噛み合っていないと
  `deploy` だけが落ちる**（`validate` と `cdk synth` は通る）。F-25 と
  `.claude/rules/agentcore-cdk.md`
- **`agentcore dev` の備え付けチャット UI と `agentcore dev "<prompt>"` からはこの Runtime を
  動かせない。** どちらもスキャフォールド由来の `{"prompt": "…"}` しか送らず、`taskId` を
  付けられないため。プロンプトを試すときはフロントエンド（localhost:3000）か curl を使う。
  UI には `INVALID_INPUT` と理由が表示される

## テスト

テストは invocation 境界（#23 のシームその1）だけを叩き、モデルは `FORMECHO_MODEL=fake` で
差し替える。**書き方の作法は `.claude/rules/formecho-agent-testing.md`** — `paths` で絞ってあるので、
テストや `model/fake.ts` を触った時に自動で載る。ここへ写さないこと。

**vitest は 3 系に留める。** node 22.22 同梱の npm 10.9.4 は vitest 4 の peer 依存で
`Cannot read properties of null (reading 'edgesOut')` を出して install できない（空のパッケージでも
再現するので、npm 側のバグ）。`hono-app` と `nextjs-app` は pnpm なので 4 系が入っており、
**このバージョン差は許容する** — 揃えるには node/npm を上げることになり、AgentCore Runtime の
実行環境に触る
