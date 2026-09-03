# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

[Hono](https://hono.dev) で書いた BFF。フロントエンドからの `POST /api/ai/tasks` を受け、
入力サニタイズと `taskId` の照合を通してから AgentCore Runtime を呼び、返ってきた構造化
データを出力契約で再検査してフロントエンドへ渡す。
`agentcore.json` からは参照されない（デプロイ対象は `agent-app/` だけ）。

**パッケージ管理は pnpm、実行ランタイムは Bun** という組み合わせ（`create-hono` の bun テンプレートを
pnpm で導入したため）。依存の追加・スクリプト実行は pnpm、`dev` の中身だけが bun。
`bun install` は使わない（`pnpm-lock.yaml` を無視して `bun.lock` を作ってしまう）。

## Commands

- 依存インストール: `pnpm install`
- 開発サーバー（ホットリロード）: `pnpm run dev` — http://localhost:8787
  （フロントエンド・Runtime とまとめて起動するならリポジトリルートで `mise run dev`）
- 型チェック: `pnpm run typecheck`
- Lint: `pnpm run lint`
- Format: `pnpm run format`（チェックのみ: `pnpm run format:check`）

Lint/format は [Biome](https://biomejs.dev)（`biome.json`）。biome 本体は devDependency として
バージョン固定してある（`2.5.11`、キャレットなし）。素の `biome` を PATH から叩かないこと
— mise が供給していない環境では別物を拾う。テストは未設定。

## Architecture

- `src/index.ts` — ルート定義とエラーの写像。`STATUS_BY_CODE` が出力契約のエラーコードから
  HTTP ステータスへの対応を1箇所に集めている。`Hono` インスタンスを default export するだけで、
  Bun のランタイムがこれを拾って HTTP を受ける。明示的な listen 呼び出しは存在しない。
- `src/lib/runtime-client.ts` — Runtime の呼び出しと、返ってきた構造化データの再検査。
  契約に反するものはフロントエンドへ通さない。推薦系では契約の
  `outputSchemaFor(taskId, input)` を通すので、**提案が入力の参加可否表と同じ候補日程を
  過不足なく指しているか**もここで見る（ADR-0004。出力契約は単独では入力を知らないので
  言えない）。Runtime の作り直しを通り抜けたものが最後にここで落ちる。
- `src/lib/sanitize.ts` — 入力サニタイズ（最大10,000文字・タグ除去）。
  **構造化入力（`input`）はこれを通さない**（ADR-0004。検査対象は職員が書いた文である）。
  代わりに `checkTaskInput` の適合だけがこの値に対する関門になるので、`src/index.ts` で
  Runtime へ渡す前に必ず弾く。
- `src/middleware/auth.ts` — 認証の差し込み口。実装は本検証環境の範囲外で、口だけ空けてある。
- 出力契約は tsconfig の `paths` で `@contracts/*` として引く（emit しないので `rootDir` の
  制約を受けない）。**`taskId` の許可リストも、自然文と構造化入力の必須性・適合も、
  出力スキーマも、すべて契約から引くので AI 機能が増えてもこの層は変更しない。** 判断は
  `checkTaskInput` と `outputSchemaFor` が持ち、この層に残るのは失敗をエラーコードと
  文言に写すところだけ（`INPUT_PROBLEM_MESSAGES`）。
- `tsconfig.json` の `jsxImportSource` は `hono/jsx`。JSX を追加した場合 React ではなく Hono 独自の
  JSX ランタイムにコンパイルされる。`types: ["bun"]` により Bun のグローバル型を参照する。

設定はすべて環境変数から読む（`src/config.ts`）。再ビルドせずに切り替えられるようにするため。
`PORT` / `FORMECHO_RUNTIME_URL` / `FORMECHO_RUNTIME_TIMEOUT_MS` / `FORMECHO_ALLOWED_ORIGINS`。

## 言語方針

本プロジェクト（FormEcho 全体）は**日本語を基本言語**として運用します。詳細は `../CLAUDE.md` の「言語方針」セクションを参照してください。

簡潔に：
- **Git コミット・コードコメント・ドキュメント**: すべて日本語
- **スキルのフォーマット**: 各スキルに従いながら、記述は日本語
