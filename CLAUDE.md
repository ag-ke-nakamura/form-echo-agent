# CLAUDE.md

## Repository layout

`agent-app/`（AgentCore Runtime）・`hono-app/`（BFF）・`nextjs-app/`（SSG フロントエンド）の3プロジェクトを並べたリポジトリ。共有しているのはハーネス（`.github/`, `lefthook.yml`, `mise.toml`, `.claude/`）と入出力契約（`contracts/`, ADR-0002）だけで、**ルートに `package.json` やワークスペース定義は無い**。

構成から読み取れない落とし穴。

- **`agentcore` コマンドは必ず `agent-app/` 内で実行する。** CLI は「自分のいるフォルダがプロジェクトルート」として振る舞うので、リポジトリルートからは "No agentcore project found" になる
- **`hono-app` の依存管理は pnpm、`dev` スクリプトのみ Bun**
- **`nextjs-app/AGENTS.md` は手編集不可**（`next dev` が自動生成する）

## 3プロセスの起動

`mise run dev` で Runtime・BFF・フロントエンドが並行起動する。ルートに `package.json` を置かない方針のため、この定義は `mise.toml` の `[tasks.*]` にしか置けない。

| プロセス | ポート | 起動元 |
| --- | --- | --- |
| AgentCore Runtime | 8080 | `agent-app/` で `agentcore dev --logs --skip-deploy` |
| BFF | 8787 | `hono-app/` で `pnpm run dev` |
| フロントエンド | 3000 | `nextjs-app/` で `pnpm run dev` |

BFF が Runtime を叩く宛先は `FORMECHO_RUNTIME_URL`、フロントエンドが BFF を叩く宛先は `NEXT_PUBLIC_API_BASE_URL`（SSG なのでビルド時に埋め込まれる）。Runtime のモデルは `FORMECHO_MODEL`（`sonnet` / `haiku` / `fake`）、BFF の Runtime クライアントは `FORMECHO_RUNTIME_CLIENT`（`local` / `fake`）で切り替える。どちらの `fake` も外部に接続しない差し替えで、テストが使う（#40、#41）。

## contracts（入出力の契約）

3プロジェクトが共有する入出力契約の正典。パッケージ化せず素の `.ts` で置き、各プロジェクトが
自前の解決経路で参照する（ADR-0002）。**Zod は3プロジェクトとも v4 に揃える。**

判断（何を受け付けるか・何で検査するか）は契約側の関数に置き、**同じ判断を2箇所に書かない。**

詳細（リクエストに何が載るか、zod を import してはいけないファイル、symlink と tsconfig の
`paths`）は `.claude/rules/contracts.md`。`contracts/`・各 `tsconfig`・BFF・Runtime の invocation・
`nextjs-app/app/lib` のいずれかを触った時に自動で載る。

## agent-app（AgentCore）

`agent-app/` は AgentCore CLI の生成物一式（`AGENTS.md`, `README.md`, `agentcore/`）と、
デプロイされる Runtime 本体（`app/FormEchoAgent/`）が同居している。**生成物には我々の内容を
書かない。**

`agentcore.json` や AgentCore リソースを触る前に `agent-app/AGENTS.md`（CLI が置くスキーマと
リファレンス）を読むこと。

**デプロイ先が未設定（`agentcore/aws-targets.json` が空）なので `agentcore deploy` と `cdk synth`
は実行できない。** `agentcore/cdk` も生成物で編集不可。

Runtime の構造・CLI の既知の穴・テスト方針は `.claude/rules/agent-app.md`。`agent-app/` 配下を
触った時に自動で載る。

## 言語方針

**日本語を基本言語**とする。コミットメッセージ、コードコメント（WHY を書く。WHAT は不要）、Markdown ドキュメント、ADR・仕様書すべて。スキルがテンプレートを提供する場合はそのフォーマットに従いつつ日本語で書く。外部ライブラリの API 名・定数は英語のまま。

## Harness guardrails

`.claude/settings.json` の `permissions`（deny / ask）と `.claude/hooks/guard-destructive-command.py`（PreToolUse）で破壊的操作を止めている。詳細はそれらのファイルを読むこと。

**このファイルの一部にしか関わらない規則は `.claude/rules/*.md` に置き、`paths` frontmatter で対象を絞る。** マッチするファイルを読んだ時だけ載るので、CLAUDE.md（毎セッション全文が載る。推奨上限200行）を太らせずに済み、なにより**その規則が効くべき作業をしている最中に確実に載る**。ここへ写して二重に持たないこと。

**ブロックされた場合は回避を試みず、対象と理由をユーザーに提示して実行を依頼する。** フラグを外す・別コマンドに言い換えるといった迂回もしない。

ガードを変更したら `python3 .claude/hooks/tests/test_guard.py` で回帰を確認する。

## 変更を出す前の確認

CI（`.github/workflows/ci.yml`）と同じものを手元で回す。

| プロジェクト | コマンド |
| --- | --- |
| `agent-app/app/FormEchoAgent` | `npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build` |
| `hono-app` | `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test` |
| `nextjs-app` | `pnpm run format:check && pnpm run lint && pnpm run test && pnpm run build` |
| `agent-app/agentcore/cdk` | `npx prettier --check . && npm run build` |

`nextjs-app` に `typecheck` は無い（`build` が兼ねる）。Runtime だけ `build` と `typecheck` の
両方を回す（`build` は `dist/` にテストを混ぜないよう除くので、`typecheck` がテストまで見る）。
`contracts/` はどのプロジェクトにも属さないので整形の経路が違う — `.claude/rules/contracts.md`。

## フォーマッター・リンター・型チェッカーの入手経路

**各プロジェクトの devDependency として持ち、`mise.toml` には置かない。** 呼び出しは `npm exec` / `pnpm exec` 経由で `node_modules/.bin` から引く。素の `biome` / `prettier` を PATH から叩くと、開発機に別途入っているものを拾う。

`mise.toml` に置くのはプロジェクト依存として表現できないものだけ（`node`, `python`, `pnpm`, `bun`, `lefthook`, `betterleaks`, `gh`, `jq`, `aws-cli`, `uv`）。

## スキル・プラグインの追加前スキャン

`claude plugin install` / `npx skills add` の前に、`.mcp.json` で宣言済みの MCP サーバー `skillspector` の `scan_skill` でスキャンする（初回のみ `uv tool install --python 3.12 'skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git'`）。

`ANTHROPIC_API_KEY` 未設定の静的スキャンは誤検知が多い（パターン検出を含むスキル自体が引っかかる）。CRITICAL 判定は最終回答ではなく、該当行を目視確認する手がかりとして扱う。

## Agent skills

### The Main Flow

**開発はこの流れに載せる。** 工程を自分の判断で飛ばさない。スキルの仕事を手作業で代替しない。

```
                  ┌─ 複数セッション規模 ─→ to-spec → to-tickets ─→ implement（チケットごと）
grill-with-docs ──┤
                  └─ 1セッションで収まる ───────────────────────→ implement（この場で）
```

**`code-review` は独立した工程ではない。** `implement` が内部で `tdd` を回し、締めに `code-review`（Standards + Spec の2軸）を走らせてからコミットする。単独で呼ぶのは、ブランチや PR を任意の基準点と比べたいときだけ。

- **`grill-with-docs`** — 設計を詰める。frontier（前提が揃った未決事項）が空になるまで質問の輪を回す。`CONTEXT.md` と ADR はこの中で書く。**working directory がある限り常にこちら**（`grill-me` は working directory が無いとき用で、記録を残さない）
- **分岐1: 会話だけで全部決まるか。** 状態モデル・業務ロジック・見ないと分からない UI のように**動かして初めて答えが出る問い**が残るなら `prototype` に寄る。往復は `handoff`（prototype は別ディレクトリに住むため）
- **分岐2: 複数セッションに跨る規模か。**
  - **跨る** → `to-spec` で spec 化 → `to-tickets` で blocking edge 付きの縦切りに割る → チケットごとに `implement`
  - **収まる** → **`to-spec` も `to-tickets` も飛ばして**その場で `implement`
- **`mattpocock-skills:code-review`** — 呼ぶときは**必ずプラグイン名を付ける**。同名が3つある（他に `code-review:code-review` と組み込みの `code-review`）

**`CONTEXT.md` の更新が要りそうな議論に入ったら `grill-with-docs` に載せる。** 用語の衝突、定義の揺れ、ADR に値する判断が出てきたら、その場で書き足さずに grilling の輪に回す。用語集と ADR はこのスキルの成果物である。

### コンテキストの扱い

**`grill-with-docs` から `to-tickets` までは1つの連続したコンテキストで通す**（`/compact` も `/clear` もしない）。grilling・spec・チケットが同じ思考の上に積まれる必要があるため。

**`implement` は逆にチケットごとに新しいコンテキストで始める。** チケットは自己完結しているので、前のチケットの文脈は捨てて `/clear` してよい。

`to-tickets` に達する前に smart zone（最新モデルで約150kトークン）に近づいたら、劣化したまま押し切らず直近の phase 境界で `/compact` する。

### 私（Claude）から呼べないスキル

`disable-model-invocation: true` が付いており **Skill ツールからは起動できない。** ユーザーが `/` で打つ必要がある。

`grill-with-docs` / `to-spec` / `to-tickets` / `implement` / `triage` / `wayfinder` / `setup-matt-pocock-skills` / `ask-matt` / `improve-codebase-architecture` / `handoff` / `grill-me` / `wait-what`

**したがって、各工程の終わりでは次のスキル名を明示して打つよう促す。** 自前のワークフローを組んで先に進めない（`to-spec` は「このスキルのワークフローを別の手段で再現するな」と明記している）。`handoff` も呼べないので、prototype detour の往復は私からは始められない。

**`grill-with-docs` の締めが特に危ない。** スキル自身のドキュメントが「closing message が開いてしまうのは既知の粗さで、main flow における答えは同じ会話の中の `to-spec` である」と書いている。**frontier が空になったら分岐2を判断し、`/mattpocock-skills:to-spec` か `/mattpocock-skills:implement` のどちらかを名指しする。**

私から呼べるのは `mattpocock-skills:code-review` / `domain-modeling` / `grilling` / `tdd` / `prototype` / `diagnosing-bugs` / `research` / `codebase-design`。

### On-ramp

**外から来た仕事は main flow の頭から入らない。**

| 入口 | スキル | 合流点と注意 |
| --- | --- | --- |
| バグ報告・要望が溜まっている | `triage` | `ready-for-agent` と brief が付いたら `implement` へ。**`to-tickets` が作ったチケットは triage しない**（既に agent-ready） |
| 何かが壊れている | `diagnosing-bugs` | **そのバグで既に red になる1コマンド**を作るまで仮説を立てない。post-mortem で「良いシームが無い」と分かったら `improve-codebase-architecture` へ |
| 1セッションに収まらない霧の塊（greenfield、巨大機能） | `wayfinder` | 決定を produce する（成果物ではない）。霧が晴れたら `to-spec` で合流 — **`implement` へ直行しない**（map の linked detail を捨てる） |

### スキルが参照する設定

- **Issue tracker** — GitHub Issues（`ag-ke-nakamura/form-echo-agent`）を `gh` CLI で操作する。`docs/agents/issue-tracker.md`
- **Triage labels** — 5つの正規ロール（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）をそのまま使う。`docs/agents/triage-labels.md`
- **Domain docs** — single-context レイアウト（ルートの `CONTEXT.md` + `docs/adr/`）。`docs/agents/domain.md`
