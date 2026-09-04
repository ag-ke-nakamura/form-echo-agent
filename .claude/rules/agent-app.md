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

## Guardrail（#43）

`guardrail/` に案A（`InvokeGuardrailChecks`）・案B（`ApplyGuardrail`）・日本固有 PII の
正規表現の3つがあり、`guardrail/load.ts` の `checkGuardrail` がまとめる。
`invoke-task.ts` がモデル呼び出しの**前**（自然文 `prompt`）と**後**（Structured Output の
パース結果）の両方でこれを呼ぶ。ADR-0001（Runtime に置く）・ADR-0009（ブロック時の文言の
詳細度）を参照。

- **設定の切り替えは `FORMECHO_GUARDRAIL_STRATEGY`**（`invoke-checks` / `apply-guardrail` /
  テスト専用の `fake`）。しきい値は `FORMECHO_GUARDRAIL_THRESHOLD_{PROMPT_ATTACK,
  SENSITIVE_INFO,CONTENT_FILTER}`（離散値 `{0,0.2,0.4,0.6,0.8,1}` または `off`。F-02）
- **日本固有 PII の正規表現（マイナンバー、`guardrail/pii.ts`）は方式によらず常に走る。**
  `InvokeGuardrailChecks` の `sensitiveInformation` に日本固有の型が無く（F-03）、
  `ApplyGuardrail` の `regexesConfig` も `toolUse.input`（Structured Output の出力）を
  評価しない（F-16）ため
- **ブロックすると `discardSession`（`domain-agent.ts`）でそのセッションの Agent を全て
  破棄する。** ブロック対象が会話履歴に残ると以降のメッセージまで連鎖ブロックする
  （F-14）。同じ `sessionId` を送り直しても、次回は空の履歴から再開する
- **案Bの Guardrail リソースはスクリプトで作る。** `agentcore.json` に Guardrail を宣言する
  枠が無いため（F-11）。`scripts/create-guardrail.ts`（`npx tsx scripts/create-guardrail.ts`）
  が Classic Tier・新規名前（`FormEchoGuardrail`）で作成する。**このスクリプトは自動実行
  されない** — 実行すると共用アカウントに実際のリソースを作る。作成後、出力される
  `guardrailId` / `version` を `FORMECHO_GUARDRAIL_ID` / `FORMECHO_GUARDRAIL_VERSION` に
  設定する
- **Runtime 実行ロールに必要な IAM 権限**（Runtime は F-26 によりまだデプロイできないため
  未適用。デプロイが解けたら `agentcore/cdk` 側で付与する。cdk は生成物のため手で編集しない
  — 付与の経路は別途検討する）:
  ```json
  [
    { "Effect": "Allow", "Action": "bedrock:InvokeGuardrailChecks", "Resource": "*" },
    { "Effect": "Allow", "Action": "bedrock:ApplyGuardrail",
      "Resource": "arn:aws:bedrock:ap-northeast-1:<account>:guardrail/<作成した guardrailId>" }
  ]
  ```
  `InvokeGuardrailChecks` はリソースレスの API なので `Resource: "*"` になる（F-08）
- **アカウントレベル適用（`PutEnforcedGuardrailConfiguration`）は有効化しない。** 有効化すると
  同一アカウント・同一リージョンの**全ての** Bedrock 呼び出し（`InvokeModel` /
  `Converse` 系）にガードレールが強制され、`bedrock:ApplyGuardrail` 権限を持たない他の
  呼び出し元が軒並み `AccessDenied` になる（F-17。共用アカウントのため影響範囲が読めない）。
  手順自体は次の通りだが、**このリポジトリでは実行しない**:
  1. 対象リージョンの Guardrail を DRAFT ではなく数値バージョンで用意する
  2. そのバージョンに対する `bedrock:ApplyGuardrail` を、影響を受けうる全ての実行ロール
     （他プロジェクトのものも含む）に事前に付与する
  3. `PutEnforcedGuardrailConfiguration` で1アカウント1リージョンにつき1つ設定する
     （Automated Reasoning のみ非対応、含めると実行時に失敗する）
  4. 解除する場合は `DeleteEnforcedGuardrailConfiguration`

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
