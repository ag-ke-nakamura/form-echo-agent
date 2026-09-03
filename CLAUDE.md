# CLAUDE.md

## Repository layout

3つの独立したプロジェクトを並べたリポジトリ。共有しているのはハーネス（`.github/`, `lefthook.yml`, `mise.toml`, `.claude/`）と出力契約（`contracts/`）だけで、ルートに `package.json` やワークスペース定義は無い。

- `agent-app/` — AWS Bedrock AgentCore プロジェクト（`FormEcho`）。**`agentcore` CLI の生成物一式がこのフォルダに収まっている**（`AGENTS.md`, `README.md`, `agentcore/`, `app/`）。CLI は「自分のいるフォルダがプロジェクトルート」として振る舞うため、**`agentcore` コマンドは必ず `agent-app/` 内で実行する**（リポジトリルートからは "No agentcore project found" になる）
- `hono-app/` — BFF。`POST /api/ai/tasks` で入力サニタイズ・`taskId` 照合・Runtime 呼び出し・出力の再検査を行う。**依存管理は pnpm、`dev` スクリプトのみ Bun**
- `nextjs-app/` — フロントエンド（SSG）。AI 機能ごとのタブを持つ。`nextjs-app/AGENTS.md` は `next dev` が自動生成するため手編集不可
- `contracts/` — 3プロジェクトが共有する出力契約（ADR-002）

## 3プロセスの起動

`mise run dev` で Runtime・BFF・フロントエンドが並行起動する。ルートに `package.json` を置かない方針のため、この定義は `mise.toml` の `[tasks.*]` にしか置けない。

| プロセス | ポート | 起動元 |
| --- | --- | --- |
| AgentCore Runtime | 8080 | `agent-app/` で `agentcore dev --logs --skip-deploy` |
| BFF | 8787 | `hono-app/` で `pnpm run dev` |
| フロントエンド | 3000 | `nextjs-app/` で `pnpm run dev` |

BFF が Runtime を叩く宛先は `FORMECHO_RUNTIME_URL`、フロントエンドが BFF を叩く宛先は `NEXT_PUBLIC_API_BASE_URL`（SSG なのでビルド時に埋め込まれる）。Runtime のモデルは `FORMECHO_MODEL`（`sonnet` / `haiku`）で切り替える。

## contracts（入出力の契約）

出力スキーマ（Zod）・リクエスト型・エラーコード・`taskId` 許可リストの正典。パッケージ化せず素の `.ts` で置き、各プロジェクトが自前の解決経路で参照する（ADR-002）。**Zod は3プロジェクトとも v4 に揃える。**

**抽出系3タスクのリクエスト契約は `{taskId, prompt, sessionId}` の3つだけで、画面が持っているフォームの状態（候補日程の一覧、入力済みの値、レコードID）を Runtime へ渡さない**（ADR-003）。`prompt` にシステムが組み立てた文脈を埋め込むこともしない。突き合わせはフロントエンドが行う。

**推薦系 `meeting.recommend-schedule` だけは構造化入力 `input` を渡す**（ADR-0004）。参加可否表を見ずに順位は付けられないため。入力契約は `INPUT_SCHEMAS` として `OUTPUT_SCHEMAS` と対称に持ち、自然文だけのタスクは `null` を明示する。自然文の必須性は `PROMPT_REQUIREMENT`（`prompt-requirement.ts`）が taskId ごとに持つ。`input` はサニタイズも Guardrail チェックも通さないので、**自由文字列を置かない**（参加者は `/^参加者[A-Z]$/`）。`input` はフロントエンドが**毎回そのまま送り直す** — Runtime 側の会話履歴はコールドスタートで消えるため。

判断は契約側の関数に置く。`checkTaskInput(taskId, {prompt, input})` が「このリクエストが入力契約を満たすか」を、`outputSchemaFor(taskId, input)` が「この応答を何で検査するか」を決める。前者は Runtime の `aiTaskRequestSchema` と BFF の門の両方が、後者は Runtime の Structured Output 再試行と BFF の再検査の両方が引く。**同じ判断を2箇所に書かない** — 片方だけが契約の変更に追随すると、BFF は通すのに Runtime が弾く（またはその逆の）状態になる。

`candidate-key.ts` と `prompt-requirement.ts` は zod を import しない。フロントエンドがこの2つだけを**値として**引くので、スキーマと同じモジュールに置くと SSG のバンドルに zod が丸ごと乗る。

参照のしかたはプロジェクトごとに違う。

- `hono-app` / `nextjs-app` — tsconfig の `paths` で `@contracts/*` を張る。どちらも emit しない（`tsc --noEmit` / bundler）ので `rootDir` の制約を受けない
- `agent-app/app/FormEchoAgent` — **`contracts` という symlink がパッケージ内にあり、`./contracts/index.js` として相対 import する。** ここだけ `paths` を使わない

**この symlink を消さないこと。** `tsc` は emit するので `rootDir` の外のファイルを取り込めず（TS6059）、`paths` エイリアスは emit 後の import 文にそのまま残るため Node が実行時に解決できない（`tsc` はエイリアスを書き換えない）。symlink なら `rootDir` 配下として扱われ、`dist/contracts/*.js` が実体として出力される。将来 CodeZip で固めるときも同じ理由で必要になる。

あわせて各プロジェクトの tsconfig には `"zod": ["./node_modules/zod"]` の `paths` がある。`contracts/` 自身の位置からは `node_modules` を辿れないため。`contracts/package.json` は `{"type": "module"}` だけを宣言するモジュール種別のマーカーで、依存もスクリプトも持たない。

## agent-app（AgentCore）

- `agent-app/agentcore/agentcore.json` がデプロイ対象のソース・オブ・トゥルース
- **`agent-app/AGENTS.md` にスキーマと CLI リファレンスがある。`agentcore.json` や AgentCore リソースを触る前に読むこと**
- `agent-app/AGENTS.md` と `agent-app/README.md` は CLI の生成物。`render()` が `copyFile` で上書きするため、我々の内容を書かない
- `agent-app/app/FormEchoAgent/` — デプロイされるエージェント本体（Strands SDK + `bedrock-agentcore`、エントリ `main.ts`）。**`main.ts` は `BedrockAgentCoreApp` への配線と起動だけを持ち、invocation のロジックは `invocation/` にある**（シームは `invocation/invoke-task.ts` の `invokeTask`）。**`npm run dev` / `npm start` を直接使わず `agentcore dev` / `agentcore deploy` 経由で操作する**（プロセス単体をデバッグする場合を除く）
- **相対的な日付・時刻は system prompt の「基準時刻」で解決する。時刻取得のツールを渡さない。** `invocation/system-prompt.ts` が JST の現在時刻を毎回埋め、`domain-agent.ts` がキャッシュ済み Agent にも貼り直す（system prompt は生成時に固定されるため、貼り直さないと追加の指示が初回の時刻から数える）。ツールでも解けるが、モデルが呼ばずに「現在時刻が分かりません」と答える失敗の余地が残る上、会議ロジにツールを1つも渡していないこと（#36）を崩す
- `agent-app/agentcore/aws-targets.json` は現在空。デプロイ先が未設定なので `agentcore deploy` と `cdk synth` は実行できない
- `agentcore package` は CLI 0.28.1 のバグで失敗する（esbuild が自身のバンドルに含まれておりバイナリを見つけられない）。`deploy` も同じ経路を通る可能性がある
- **`agentcore dev` の備え付けチャット UI と `agentcore dev "<prompt>"` からはこの Runtime を動かせない。** どちらもスキャフォールド由来の `{"prompt": "…"}` しか送らず、`taskId` を付けられないため。プロンプトを試すときはフロントエンド（localhost:3000）か curl を使う。UI には `INVALID_INPUT` と理由が表示される
- リクエストの検査を `BedrockAgentCoreApp` の `requestSchema` に任せない。bedrock-agentcore 0.3.0 は検査に落ちたとき 400 の本文を Content-Type 指定なしで送るが、呼び出し側が `Accept: text/event-stream` だと `@fastify/sse` が応答を握っており fastify が object を拒否する（`FST_ERR_REP_INVALID_PAYLOAD_TYPE`）。結果、**本文の無い 500** になって原因が伝わらない。`invocation/handler.ts` の中で `aiTaskRequestSchema` を回すこと

## 言語方針

**日本語を基本言語**とする。コミットメッセージ、コードコメント（WHY を書く。WHAT は不要）、Markdown ドキュメント、ADR・仕様書すべて。スキルがテンプレートを提供する場合はそのフォーマットに従いつつ日本語で書く。外部ライブラリの API 名・定数は英語のまま。

## 作業の締め方

**完了報告で終わらせない。必ず「次に何をするか」の候補を添える。** 実装が終わった、レビューが通った、PR を出した — どれも節目であって終点ではない。ここで止めると、次の一手を毎回こちらから聞き出すことになる。

添えるのは次の3つ。

- **こちらが今すぐ実行できること**（PR を出す、マージする、次のチケットに入る）。選択肢が1つならそう言い切る
- **判断を仰ぎたいこと**。何を決めれば先に進めるのかを、選択肢と各々の帰結つきで書く
- **人間にしかできないこと**（ブラウザでの目視、AWS コンソールでの操作、外部への連絡）。何を見てほしいのかを具体的に書く

未決事項を並べるだけでは足りない。それが「次に何をするか」に変換されていること。

## Harness guardrails

`.claude/settings.json` の `permissions`（deny / ask）と `.claude/hooks/guard-destructive-command.py`（PreToolUse）で破壊的操作を止めている。詳細はそれらのファイルを読むこと。

**ブロックされた場合は回避を試みず、対象と理由をユーザーに提示して実行を依頼する。** フラグを外す・別コマンドに言い換えるといった迂回もしない。

ガードを変更したら `python3 .claude/hooks/tests/test_guard.py` で回帰を確認する。

## 変更を出す前の確認

CI（`.github/workflows/ci.yml`）と同じものを手元で回す。

| プロジェクト | コマンド |
| --- | --- |
| `agent-app/app/FormEchoAgent` | `npm run format:check && npm run lint && npm run build` |
| `hono-app` | `pnpm run format:check && pnpm run lint && pnpm run typecheck` |
| `nextjs-app` | `pnpm run format:check && pnpm run lint && pnpm run test && pnpm run build` |
| `agent-app/agentcore/cdk` | `npx prettier --check . && npm run build` |

`nextjs-app` に `typecheck` スクリプトは無い（型検証は `build` が兼ねる）。`test` があるのは
`nextjs-app` だけで、対象は参加可否表のモック生成器1つ（#58 のシーム3）。Runtime と BFF の
テスト基盤は #40 / #41 で入る。`contracts/` はどのプロジェクトにも属さないので、整形は `agent-app/app/FormEchoAgent` の biome で見る（`./node_modules/.bin/biome check ../../../contracts`）。

## フォーマッター・リンター・型チェッカーの入手経路

**各プロジェクトの devDependency として持ち、`mise.toml` には置かない。** 呼び出しは `npm exec` / `pnpm exec` 経由で `node_modules/.bin` から引く。素の `biome` / `prettier` を PATH から叩くと、開発機に別途入っているものを拾う。

`mise.toml` に置くのはプロジェクト依存として表現できないものだけ（`node`, `python`, `pnpm`, `bun`, `lefthook`, `betterleaks`, `gh`, `jq`, `aws-cli`, `uv`）。

## agent-app/agentcore/cdk

生成物のため編集不可。コマンドは `npm run build` / `npm run format`。CI は format と build のみ（`npm test` は生成されたテストが空 spec の synth しか見ておらず build と重複するため意図的に外している）。

**`@aws/agentcore-cdk` はキャレットを付けずに固定する。** `agentcore create` は `^0.1.0-alpha.19` を宣言するが、この範囲は最新 alpha を招き入れ、生成コードは古い API 世代に対して書かれているため**生成した瞬間に build が壊れる**（実際 alpha.49 の `connectorName` → `connector` 変更で Initial commit から壊れていた。alpha.51 が両形を受け付けるので固定して解消）。CLI を更新しても直らない。

このディレクトリは dependabot のバージョン更新を止めてある（理由は `.github/dependabot.yml` のコメント）。手で上げるときは必ず `npm run build` を通し、壊れていたら直近の互換 alpha に戻す。

## スキル・プラグインの追加前スキャン

`claude plugin install` / `npx skills add` の前に、`.mcp.json` で宣言済みの MCP サーバー `skillspector` の `scan_skill` でスキャンする（初回のみ `uv tool install --python 3.12 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git'`）。

`ANTHROPIC_API_KEY` 未設定の静的スキャンは誤検知が多い（パターン検出を含むスキル自体が引っかかる）。CRITICAL 判定は最終回答ではなく、該当行を目視確認する手がかりとして扱う。

## Agent skills

### Issue tracker

issue は GitHub Issues（`ag-ke-nakamura/form-echo-agent`）で管理し、`gh` CLI 経由で操作する。詳細は `docs/agents/issue-tracker.md`。

### Triage labels

triage ラベルは5つの正規ロール（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）をそのまま使う。詳細は `docs/agents/triage-labels.md`。

### Domain docs

single-context レイアウト（ルートの `CONTEXT.md` + `docs/adr/`）。詳細は `docs/agents/domain.md`。
