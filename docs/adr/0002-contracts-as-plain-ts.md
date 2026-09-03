# 出力契約を workspace 化せず `contracts/` に素の .ts で置く

- **Status**: accepted
- **Date**: 2026-09-03

Structured Output のスキーマは Runtime（生成側）・BFF（検証側）・フロントエンド（フォーム反映側）の3者が同一のものを見る必要がある。本番リポジトリでは `packages/contracts` のようなパッケージになる想定だが、本検証環境では**パッケージ化せず、リポジトリルートの `contracts/` に素の TypeScript ファイルとして置き、各プロジェクトの tsconfig の `paths` から相対参照する**。

理由は、3プロジェクトのパッケージマネージャが分かれていること（`agent-app` は npm、`hono-app` は pnpm + bun、`nextjs-app` は pnpm で独自の `pnpm-workspace.yaml` を持つ）と、`CLAUDE.md` がルートに `package.json` やワークスペース定義を置かない方針を明記していることの2つ。素の .ts ならパッケージマネージャに依存しない。

`contracts/` に置くのは出力スキーマ（Zod）、リクエスト型、エラーコード、`taskId` 許可リスト。Zod は3プロジェクトとも v4 に揃える。フォームのラベルや入力種別といった表示メタデータは UI 側の関心事なので含めない。

## Considered Options

- **ルートに pnpm workspace を導入して `packages/contracts` にする**: 本番の姿に最も近い。ただし npm 管理の `agent-app` を同じ workspace に取り込めず、`CLAUDE.md` の構成方針の変更も伴う。検証の本題（プロンプトと AgentCore）から遠い労力がかかる
- **素の .ts + tsconfig の `paths`（採用）**: パッケージマネージャ非依存。本番移行時はディレクトリごとパッケージ化するだけで済む
- **各プロジェクトに手でコピー**: 最も簡単だが3方向にドリフトする。3者が同じ `taskId` 許可リストを見ないと破綻する設計なので許容できない
- **`agent-app` を正として他が相対 import**: agent-app のディレクトリ構造の変更が他2つに波及する

## Consequences

- `contracts/` は独立したパッケージではないので、依存（Zod）は各プロジェクトが自前で持つ。バージョンのずれは自動的には防げず、意図的に v4 で揃える運用になる
- 各プロジェクトの tsconfig に `paths` と `include` の設定が増える。ビルドツール（Next.js の webpack/turbopack、bun、tsc）がそれぞれ `rootDir` の外のファイルを解決できる設定を要する
