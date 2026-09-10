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
- **ツールはドメインごとの表（`tools/load.ts`）から引く。** 交通ICと検証ドメインが Web 検索
  （AgentCore Gateway、`FORMECHO_WEB_SEARCH_GATEWAY_URL`）を持ち、**会議ロジには渡さない** —
  後回しではなくそもそも不要（F-22）で、渡さないこと自体が #46 の成果に含まれる。
  検証ドメインが持つのは ADR-0020（検索を使わせるプロンプトの効きを試せることがあの画面の
  値打ちの1つ）。
  検索回数の上限はリクエスト単位なので `AsyncLocalStorage`（`tools/web-search.ts`）で持ち、
  `invokeTask` が全体を包む。**`agent.invoke` ごとの `invocationState` では Structured Output の
  作り直しで予算が戻ってしまう**
- **相対的な日付・時刻は system prompt の「基準時刻」で解決する。時刻取得のツールを渡さない。**
  `invocation/system-prompt.ts` が JST の現在時刻を毎回埋め、`domain-agent.ts` がキャッシュ済み
  Agent にも貼り直す（system prompt は生成時に固定されるため、貼り直さないと追加の指示が初回の
  時刻から数える）。**貼り直すのは「基準時刻を足す前の素材」が前回と同じときだけ**で、変われば
  Agent ごと作り直して履歴を捨てる（#204。実際に変わるのは持ち込みシステムプロンプトを使う
  `playground.free-prompt` だけ）。比較に全文を使わないのは、全文が分単位で動くため。ツールでも解けるが、モデルが呼ばずに「現在時刻が分かりません」と答える失敗の
  余地が残る上、会議ロジにツールを1つも渡していないこと（#36）を崩す
- **リクエストの検査を `BedrockAgentCoreApp` の `requestSchema` に任せない。** bedrock-agentcore
  0.3.0 は検査に落ちたとき 400 の本文を Content-Type 指定なしで送るが、呼び出し側が
  `Accept: text/event-stream` だと `@fastify/sse` が応答を握っており fastify が object を拒否する
  （`FST_ERR_REP_INVALID_PAYLOAD_TYPE`）。結果、**本文の無い 500** になって原因が伝わらない。
  `invocation/handler.ts` の中で `aiTaskRequestSchema` を回すこと

## 実行制限（#125）

**張り先は `agentcore.json` ではなく Strands の `InvokeOptions`**（`agent.invoke` の第2引数。
`structuredOutputSchema` を渡しているのと同じオブジェクト）。`maxIterations` / `maxTokens` /
`timeoutSeconds` は AgentCore **harness** のパラメータで、自前の Strands ループを Runtime に
載せる本構成には宣言する場所が無い。`invocation/structured-output.ts` が `limits.turns`
（値の根拠は #121 の往復回数の実測）と `cancelSignal`（`config.ts` の
`resolveAgentLoopTimeoutMs`、`FORMECHO_AGENT_LOOP_TIMEOUT_MS`、既定 55,000ms）を渡す。
張らない上限（`limits.outputTokens` / `limits.totalTokens`）とその理由はコードのコメント。

- **`limits` のカウンタは `agent.invoke` ごとにリセットされる。** Web 検索の回数上限と同じ罠で、
  内側に張ると Structured Output の作り直しで残高が戻り、外側の2試行がそれぞれ満額の予算を得る
  （実質2倍）。**壁時計はリクエスト単位**にし、`invokeTask` の入口で1つ作って両方の試行に渡す
- **Runtime 側（既定55秒）を BFF 側（`hono-app` の `RUNTIME_TIMEOUT_MS`、既定60秒）より短く
  保つ。片方だけ変えるとこの関係が崩れる。** 崩れると、BFF が職員に `TIMEOUT` を返した後も
  Runtime が AgentCore Runtime の同期タイムアウト（15分。調整不可）まで走り続け、誰も受け取ら
  ない応答のために Bedrock のトークンを消費する。**別プロジェクトの定数の大小なので自動テストで
  は守らない** — 片方しか見えないテストでは関係を検査できない。歯止めは `config.ts` のコメント
- **発火時のエラーコードは `PARSE_FAILED`**（職員の取る行動が作り直しの尽きた場合と同じ）。
  運用側が要る「契約に適合しなかった」と「上限で切った」の区別は `stopReason` の warn ログが担う
- **素のテキストで返す経路（`invocation/plain-text.ts`、`playground.free-prompt`）だけは
  `PARSE_FAILED` にせず投げ直す**（ADR-0020）。あのコードが表すのは「出力契約に届かなかった」で、
  出力契約が `{ text }` 1欄のあの経路には届かない出力が存在しない。投げ直せば handler が 500 にし、
  BFF が `RUNTIME_UNAVAILABLE` に写す。**返してはいけない** — 途中まで書かれたテキスト（多くは
  空文字）が成功として画面に出て、職員はそれをプロンプトの効きとして読む。上限の値
  （`MAX_AGENT_TURNS`・壁時計）と `stopReason` の warn ログは Structured Output の経路と共有する

## Skill の解決（#42・ADR-0013）

**`taskId` が Skill を一意に決める。** `invocation/system-prompt.ts` の `buildSystemPrompt` が
`SKILLS[taskId]`（`skills/registry.ts`）の instructions をそのまま system prompt へ埋め込む。
レジストリは `Record<Exclude<TaskId, typeof FREE_PROMPT_TASK_ID>, string>` のフラットな表で、
**キーが `TaskId` 型なので taskId を足したときの登録漏れが型エラーになる。**

**`playground.free-prompt` だけが Skill を持たない**（ADR-0020）。あの taskId の system prompt は
職員が `input.system_prompt` で持ち込む文そのもので、我々が足すのは基準時刻の付記1つだけである
（`systemPromptSource` がこの分岐を持つ）。**除外を `Exclude` で書くので、他4タブの登録漏れは
引き続き型エラーになる** — レジストリを `Partial` にして緩めないこと。

**Skill の本文は `SKILL.md` ではなく `skills/{domain}/{task}.ts` に TypeScript のデータ
（instructions の文字列）として直接書く**（ADR-0012）。デプロイ済み Runtime（CodeZip）は
esbuild が `main.ts` から辿れる import グラフだけをバンドルし、fs 経由で読む非コードの
アセットは zip に含まれない（#45。
`agentcore dev` のローカル実行は `skills/` がそのまま残っているため気付けなかった）。一度は
`SKILL.md` → 生成スクリプト → `skills/embedded.ts` という形にしたが、一次情報と生成物が並存
する構造自体が受け入れられず却下した。**`skills/{domain}/{task}.ts` が唯一の実体** — 生成も
drift-guard テストも無い。

**ドメインエージェントに Skill を選ばせる設計は採らない**（判断は ADR-0013、根拠の実測は
`docs/reference-doc-fixes.md` F-09）。**Runtime は `@strands-agents/sdk/vended-plugins/skills`
に依存しない。**

配線（Skill を持つ4つの taskId がそれぞれの instructions を受け取る・他の Skill が混ざらない）は
`invocation/handler.test.ts` の「taskId の解決」が境界越しに見る。`playground.free-prompt` に
Skill が1つも混ざらないことは同ファイルの「playground.free-prompt（ADR-0020）」が見る。

## Guardrail（#43）

`guardrail/` に `InvokeGuardrailChecks`（AWS 側の判定）と日本固有 PII の正規表現チェックの
2つがあり、`guardrail/load.ts` の `checkGuardrail` がまとめる。`invoke-task.ts` がモデル
呼び出しの**前**（自然文 `prompt`）と**後**（Structured Output のパース結果）の両方でこれを
呼ぶ。ADR-0001（Runtime に置く）・ADR-0009（ブロック時の文言の詳細度）を参照。

**経路はこの1本に畳んである（ADR-0013）。** 元は案A（`InvokeGuardrailChecks`）・案B
（`ApplyGuardrail`）・正規表現チェックを独立に ON/OFF できる形で、どちらの方式を採るかの
実測（#44）のためにそうしていた。案Bのコード経路と切り替えフラグは削除済みで、**復活させる
提案をする前に ADR-0013 を読むこと。**

- **2つの経路はどちらも常時有効で、env で切り替えられない。** 片方だけでは足りないことが
  #44 で数字になっている — `InvokeGuardrailChecks` は Prompt Attack を日英とも 8/8 で
  ブロックするがマイナンバーを 0/8 しか検知せず、正規表現チェックは逆にマイナンバー専用。
  在るフラグは `FORMECHO_GUARDRAIL_STRATEGY=fake` だけで、これはテスト専用（`InvokeGuardrailChecks`
  の呼び先を fake に差し替える。正規表現チェックは純関数なので対象外）
- **しきい値は `config.ts` の定数 `GUARDRAIL_THRESHOLDS`**（`promptAttack` は `>= 0.8`、
  `sensitiveInformation` は `>= 0.6`、`contentFilter` は記録のみでブロックしない）。値は
  離散スコアの格子 `{0, 0.2, 0.4, 0.6, 0.8, 1}` 上からしか選べない（F-02。`> 0.8` は
  `== 1.0` と同義になり 0.8 を素通しする）ので、`GuardrailScore` 型で縛ってある。
  `contentFilter` を記録のみにしているのは、日本語では露骨でない表現のスコアが下がる
  （F-06）ため — 0.2 まで下げると誤検知が実用に耐えない
- **日本固有 PII の正規表現チェック（マイナンバー、`guardrail/pii.ts`）と
  `InvokeGuardrailChecks` は重複して検知しうる。** `InvokeGuardrailChecks` の
  `sensitiveInformation` に日本固有の型が無い（F-03）ため正規表現が恒久的に必要で、
  `GuardrailFinding.source`（`'code-regex' | 'strategy'`）でどちらが検知したかを区別する
- **`sensitiveInformation` の検知対象に `ADDRESS` / `NAME` 等の汎用カテゴリを含めない
  こと。** 日本語でも confidence 1.0 で検知されるため（F-06）、`ic-card.parse-reservation`
  が行き先という**住所そのもの**を抽出する正常な出力と衝突し誤検知する（実機で確認済み。
  `invoke-checks.ts` の `SENSITIVE_INFORMATION_ENTITIES` を参照）。資格情報・金融/政府
  発行の識別子だけに絞ってある
- **ブロックすると `discardSession`（`domain-agent.ts`）でそのセッションの Agent を全て
  破棄する。** ブロック対象が会話履歴に残ると以降のメッセージまで連鎖ブロックする
  （F-14）。同じ `sessionId` を送り直しても、次回は空の履歴から再開する
- **Guardrail 実クラウドリソース**（`FormEchoGuardrail`、Classic Tier）**の CDK 定義は
  #126 で削除した。** 案Bのために作ったもので、読むコードはもう無い（ADR-0013）。
  `agent-app/infra` に残るのは Runtime 実行ロールへの権限付与だけ。**実リソースの破棄
  （`npx cdk deploy` による削除の反映）は人が実行する** — 共用アカウントの実リソースを
  作る・消す操作なので、`npx cdk deploy` / `cdk destroy` は自動実行しない
- **Runtime 実行ロールに必要な IAM 権限**（cdk は生成物のため手で編集しない —
  `agent-app/infra` の `FormEchoAgentInfraStack` が `cdk.json` にキャッシュされた ARN
  （`scripts/cache-runtime-role-arn.ts` が `agentcore status --json` の `roleArn` から
  書き込む）で agentcore 管理のロールを参照する。ADR-0010 の Consequences 参照）:
  ```json
  [{ "Effect": "Allow", "Action": "bedrock:InvokeGuardrailChecks", "Resource": "*" }]
  ```
  `InvokeGuardrailChecks` はリソースレスの API なので `Resource: "*"` になる（F-08）。
  **`bedrock:ApplyGuardrail` は付与しない**（案Bを採用しないため。ADR-0010 が約束していた
  「デプロイする回でまとめて追加する」は ADR-0013 により来ない）
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
  skill directory`）。対処は上の「Skill の解決（#42・ADR-0013）」の `skills/{domain}/{task}.ts`
  （ADR-0012）を参照。**この境界（import グラフに乗るものだけがデプロイ先に届く）は他の
  非コードアセットを足すときにも効く。**
  検討して採らなかった代替案（#45）: **`build: Container`**（`skills/` はそのまま届くが、
  `agentcore dev` がローカルでも `docker build` するため Docker デーモンが常に必要になる —
  実機で確認済み）。**S3 から `SKILL.md` を都度ダウンロードする**（Harness の Skills 機能や
  AgentCore Runtime の Bring-Your-Own ファイルシステムが使う手筋だが、後者はネイティブ機能
  として使うと `networkMode: VPC` が必須で、VPC 化は #45 が別途除外した VPC Endpoint 一式
  まで巻き取る。自前でダウンロードコードを書けば VPC は避けられるが、Runtime 実行ロールへの
  IAM 権限付与が ADR-0010 で未解決のクロススタック参照問題に当たる）。
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
