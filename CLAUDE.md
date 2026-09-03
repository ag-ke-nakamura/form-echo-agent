# CLAUDE.md

## Repository layout

3つの独立したプロジェクトを並べたリポジトリ。共有しているのはハーネス（`.github/`, `lefthook.yml`, `mise.toml`, `.claude/`）と出力契約（`contracts/`）だけで、ルートに `package.json` やワークスペース定義は無い。

- `agent-app/` — AWS Bedrock AgentCore プロジェクト（`FormEcho`）。**`agentcore` CLI の生成物一式がこのフォルダに収まっている**（`AGENTS.md`, `README.md`, `agentcore/`, `app/`）。CLI は「自分のいるフォルダがプロジェクトルート」として振る舞うため、**`agentcore` コマンドは必ず `agent-app/` 内で実行する**（リポジトリルートからは "No agentcore project found" になる）
- `hono-app/` — Hono スキャフォールド。**依存管理は pnpm、`dev` スクリプトのみ Bun**
- `nextjs-app/` — Next.js 16 + pnpm スキャフォールド。`nextjs-app/AGENTS.md` は `next dev` が自動生成するため手編集不可
- `contracts/` — 3プロジェクトが共有する出力契約（ADR-002）

## 3プロセスの起動

`mise run dev` で Runtime・BFF・フロントエンドが並行起動する。ルートに `package.json` を置かない方針のため、この定義は `mise.toml` の `[tasks.*]` にしか置けない。

| プロセス | ポート | 起動元 |
| --- | --- | --- |
| AgentCore Runtime | 8080 | `agent-app/` で `agentcore dev --logs --skip-deploy` |
| BFF | 8787 | `hono-app/` で `pnpm run dev` |
| フロントエンド | 3000 | `nextjs-app/` で `pnpm run dev` |

BFF が Runtime を叩く宛先は `FORMECHO_RUNTIME_URL`、フロントエンドが BFF を叩く宛先は `NEXT_PUBLIC_API_BASE_URL`（SSG なのでビルド時に埋め込まれる）。Runtime のモデルは `FORMECHO_MODEL`（`sonnet` / `haiku`）で切り替える。

## contracts（出力契約）

出力スキーマ（Zod）・リクエスト型・エラーコード・`taskId` 許可リストの正典。パッケージ化せず素の `.ts` で置き、各プロジェクトが自前の解決経路で参照する（ADR-002）。**Zod は3プロジェクトとも v4 に揃える。**

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
- `agent-app/agentcore/aws-targets.json` は現在空。デプロイ先が未設定なので `agentcore deploy` と `cdk synth` は実行できない
- `agentcore package` は CLI 0.28.1 のバグで失敗する（esbuild が自身のバンドルに含まれておりバイナリを見つけられない）。`deploy` も同じ経路を通る可能性がある
- **`agentcore dev` の備え付けチャット UI と `agentcore dev "<prompt>"` からはこの Runtime を動かせない。** どちらもスキャフォールド由来の `{"prompt": "…"}` しか送らず、`taskId` を付けられないため。プロンプトを試すときはフロントエンド（localhost:3000）か curl を使う。UI には `INVALID_INPUT` と理由が表示される
- リクエストの検査を `BedrockAgentCoreApp` の `requestSchema` に任せない。bedrock-agentcore 0.3.0 は検査に落ちたとき 400 の本文を Content-Type 指定なしで送るが、呼び出し側が `Accept: text/event-stream` だと `@fastify/sse` が応答を握っており fastify が object を拒否する（`FST_ERR_REP_INVALID_PAYLOAD_TYPE`）。結果、**本文の無い 500** になって原因が伝わらない。`invocation/handler.ts` の中で `aiTaskRequestSchema` を回すこと

## 言語方針

**日本語を基本言語**とする。コミットメッセージ、コードコメント（WHY を書く。WHAT は不要）、Markdown ドキュメント、ADR・仕様書すべて。スキルがテンプレートを提供する場合はそのフォーマットに従いつつ日本語で書く。外部ライブラリの API 名・定数は英語のまま。

## Harness guardrails

`.claude/settings.json` の `permissions`（deny / ask）と `.claude/hooks/guard-destructive-command.py`（PreToolUse）で破壊的操作を止めている。詳細はそれらのファイルを読むこと。

**ブロックされた場合は回避を試みず、対象と理由をユーザーに提示して実行を依頼する。** フラグを外す・別コマンドに言い換えるといった迂回もしない。

ガードを変更したら `python3 .claude/hooks/tests/test_guard.py` で回帰を確認する。

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
