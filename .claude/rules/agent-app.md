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

## Skill 選択の2モード（#42）

`config.ts` の `resolveSkillSelectionMode()`（`FORMECHO_SKILL_SELECTION_MODE`、既定
`explicit`）で切り替える。両モードとも同じ `skills/{domain}/{task}/SKILL.md` の中身を
プロンプトの実体として使う。

**`SKILL.md` をファイルパスとして直接読まない。** デプロイ済み Runtime（CodeZip）は
esbuild が `main.ts` から辿れる import グラフだけをバンドルし、fs 経由で読む非コードの
アセットは zip に含まれない（#45。`agentcore dev` のローカル実行は `skills/` が
そのまま残っているため気付けなかった）。代わりに `skills/embedded.ts`（生成物 —
`SKILL.md` から `npm run generate:skills` で作り直す。両者の一致は `skills/embedded.test.ts`
が見る）が `SKILL.md` の中身を文字列として import グラフに乗せ、`Skill.fromContent()`
でパースする。**`SKILL.md` を編集したら `npm run generate:skills` を忘れないこと**
（忘れるとテストが落ちる）。

- **`explicit`**（既定）— `taskId` が Skill を一意に決める。`invocation/system-prompt.ts`
  の `loadSkill` が `EMBEDDED_SKILLS[domain][task]` を `Skill.fromContent` に渡し、
  instructions を system prompt に埋め込む
- **`auto`** — ドメインエージェントが `AgentSkills` プラグイン（`@strands-agents/sdk/vended-plugins/skills`）
  の progressive disclosure で選ぶ（ADR-032 論点4）。`invocation/domain-agent.ts` の
  `DOMAIN_SKILLS_PLUGINS` がドメインごとに1つ持ち、`EMBEDDED_SKILLS[domain]` の値を
  `Skill.fromContent` した Skill インスタンスの配列だけを渡す — **ドメインエージェントは
  自分のドメインの `SKILL.md` しか読まない。** この場合 `buildSystemPrompt` は Skill の
  本文を注入せず（メタデータの注入と活性化はプラグイン側が持つ）、モデルは `skills`
  ツールを呼んで activate する
- **Skill 選択の的中率の実測は #44 の範囲。** ここで押さえるのは配線（モードの切り替え・
  ドメインの隔離・両モードが同じ `SKILL.md` の中身を使うこと）で、`invocation/handler.test.ts`
  の「Skill 選択の2モード（#42）」が見る

## Guardrail（#43）

`guardrail/` に案A（`InvokeGuardrailChecks`）・案B（`ApplyGuardrail`）・日本固有 PII の
正規表現チェックの3つがあり、`guardrail/load.ts` の `checkGuardrail` がまとめる。
`invoke-task.ts` がモデル呼び出しの**前**（自然文 `prompt`）と**後**（Structured Output の
パース結果）の両方でこれを呼ぶ。ADR-0001（Runtime に置く）・ADR-0009（ブロック時の文言の
詳細度）を参照。

**正規表現チェックを「案C」と呼ばないこと。** チケット #43 が「案Cは採らない」と言うときの
案Cは `BedrockModel` の `guardrailConfig`（不採用）を指す。この正規表現チェックはそれとは
別物で、案A・案Bのどちらを選んでも必要になる補助的なチェック（F-03・F-16）であり、A/B と
並ぶ実装方式の選択肢ではない。実装の初期段階でこの用語を混同していた（#43 のコメント参照）。

- **案A・案B・正規表現チェックはそれぞれ独立に ON/OFF できる**
  （`FORMECHO_GUARDRAIL_INVOKE_CHECKS` / `FORMECHO_GUARDRAIL_APPLY_GUARDRAIL` /
  `FORMECHO_GUARDRAIL_CUSTOM_REGEX`、いずれも `true`/`false`。既定は案A・正規表現
  チェックが ON、案Bは Guardrail リソースが要るため OFF）。1つの排他的な選択に
  していないのは、「案Aだけ／案Bだけでマイナンバーを検知できるか」を実測で
  切り分けるため — 正規表現チェックが常時 ON だと、案A・案Bのどちらを選んでも
  結果がそちらに覆い隠されて区別が付かない。`FORMECHO_GUARDRAIL_STRATEGY=fake` は
  テスト専用で、案A・案Bの呼び先を fake に差し替える（正規表現チェックは純関数
  なので対象外）。しきい値（案Aのみ）は
  `FORMECHO_GUARDRAIL_THRESHOLD_{PROMPT_ATTACK,SENSITIVE_INFO,CONTENT_FILTER}`
  （離散値 `{0,0.2,0.4,0.6,0.8,1}` または `off`。F-02）
- **日本固有 PII の正規表現チェック（マイナンバー、`guardrail/pii.ts`）は案A・案Bと
  重複して検知しうる。** `InvokeGuardrailChecks` の `sensitiveInformation` に日本
  固有の型が無く（F-03）、`ApplyGuardrail` の `regexesConfig` も `toolUse.input`
  （Structured Output の出力）を評価しない（F-16）ため、既定ではこのチェックも ON
  にして常時カバーする。`GuardrailFinding.source`（`'code-regex' | 'strategy'`）で
  どちらが検知したかを区別できる
- **`sensitiveInformation` の検知対象に `ADDRESS` / `NAME` 等の汎用カテゴリを含めない
  こと。** 日本語でも confidence 1.0 で検知されるため（F-06）、`ic-card.parse-reservation`
  が行き先という**住所そのもの**を抽出する正常な出力と衝突し誤検知する（実機で確認済み。
  `invoke-checks.ts` の `SENSITIVE_INFORMATION_ENTITIES` を参照）。資格情報・金融/政府
  発行の識別子だけに絞ってある
- **ブロックすると `discardSession`（`domain-agent.ts`）でそのセッションの Agent を全て
  破棄する。** ブロック対象が会話履歴に残ると以降のメッセージまで連鎖ブロックする
  （F-14）。同じ `sessionId` を送り直しても、次回は空の履歴から再開する
- **案Bの Guardrail リソースは `agent-app/infra` の独立 CDK スタックで作る**
  （`FormEchoAgentInfra`、ADR-0010）。`agentcore.json` に Guardrail を宣言する枠が無く
  （F-11）、`agentcore/cdk` は生成物で手書きのリソースを混在させられないため。
  Classic Tier・新規名前（`FormEchoGuardrail`）で作成する（`agent-app/infra/lib/guardrail-config.ts`）。
  **`npx cdk deploy` は自動実行されない** — 実行すると共用アカウントに実際のリソースを作る。
  作成後、CFN 出力の `GuardrailIdOutput` / `GuardrailVersionOutput` を
  `FORMECHO_GUARDRAIL_ID` / `FORMECHO_GUARDRAIL_VERSION` に設定する
- **Runtime 実行ロールに必要な IAM 権限**（Runtime はまだデプロイ未確認のため未適用。
  デプロイが確認できたら付与する。cdk は生成物のため手で編集しない — `agent-app/infra`
  スタックから agentcore 管理のロールをどう参照するか〔cross-stack export か
  `agentcore status` 等での動的解決か〕は ADR-0010 の Consequences に未解決のまま残っている）:
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
- **`runtimes` を含む synth が CodeZip の esbuild で `zod` を解決できず失敗する問題
  （`docs/reference-doc-fixes.md` F-26）は、Runtime のスキーマ定義を `contracts/` の symlink
  から `agent-app/app/FormEchoAgent/contracts/` の自己完結の複製へ変えたことで構造的には
  解消した**（ADR-0011。symlink を経由しなくなったため、`agent-app` 自身の `node_modules`
  から通常どおり `zod` を解決できる）。**実際に synth・deploy が通ることは #45 で確認済み**
  （Runtime ARN が `agent-app/agentcore/.cli/deployed-state.json` にある）
- **Node の `CodeZip` は esbuild が import グラフだけをバンドルし、非コードのアセットは
  zip に含まれない（#45）。** `skills/**/SKILL.md` を fs 経由で読む実装で実際にこれを踏み、
  デプロイ済み Runtime だけが起動時に落ちた（`skill path does not exist or is not a valid
  skill directory`）。対処は上の「Skill 選択の2モード（#42）」の `skills/embedded.ts` を
  参照。**この境界（import グラフに乗るものだけがデプロイ先に届く）は他の非コードアセットを
  足すときにも効く。**
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
