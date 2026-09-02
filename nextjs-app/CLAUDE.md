@AGENTS.md

## Project overview

Next.js 16 + pnpm の雛形。`app/layout.tsx` と `app/page.tsx` のみで、独自ロジックは未実装。
`agentcore.json` からは参照されていない独立した実験用ディレクトリ。

## Commands

- 依存インストール: `pnpm install`
- 開発サーバー: `pnpm run dev`
- ビルド: `pnpm run build`
- Lint: `pnpm run lint`（ESLint。`eslint.config.mjs`）

`typecheck` スクリプトは未定義（`hono-app` とは非対称）。型検証は `pnpm run build` が兼ねている。
テストは未設定。

## 言語方針

本プロジェクト（FormEcho 全体）は**日本語を基本言語**として運用します。詳細は `../CLAUDE.md` の「言語方針」セクションを参照してください。

簡潔に：
- **Git コミット・コードコメント・ドキュメント**: すべて日本語
- **スキルのフォーマット**: 各スキルに従いながら、記述は日本語
- **AGENTS.md は手編集不可**: `next dev` が自動生成するため
