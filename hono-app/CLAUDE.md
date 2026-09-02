# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

[Hono](https://hono.dev) の最小構成アプリ。`src/index.ts` に単一ルートだけの雛形。
`agentcore.json` からは参照されていない独立した実験用ディレクトリ。

**パッケージ管理は pnpm、実行ランタイムは Bun** という組み合わせ（`create-hono` の bun テンプレートを
pnpm で導入したため）。依存の追加・スクリプト実行は pnpm、`dev` の中身だけが bun。
`bun install` は使わない（`pnpm-lock.yaml` を無視して `bun.lock` を作ってしまう）。

## Commands

- 依存インストール: `pnpm install`
- 開発サーバー（ホットリロード）: `pnpm run dev` — http://localhost:3000
- 型チェック: `pnpm run typecheck`
- Lint: `pnpm run lint`
- Format: `pnpm run format`（チェックのみ: `pnpm run format:check`）

Lint/format は [Biome](https://biomejs.dev)（`biome.json`）。biome 本体は devDependency ではなく
mise が PATH に供給する。テストは未設定。

## Architecture

- `src/index.ts` がアプリ全体。`Hono` インスタンスを default export するだけで、Bun のランタイムが
  この default export を拾って HTTP を受ける。明示的な listen 呼び出しは存在しない。
- `tsconfig.json` の `jsxImportSource` は `hono/jsx`。JSX を追加した場合 React ではなく Hono 独自の
  JSX ランタイムにコンパイルされる。`types: ["bun"]` により Bun のグローバル型を参照する。

## 言語方針

本プロジェクト（FormEcho 全体）は**日本語を基本言語**として運用します。詳細は `../CLAUDE.md` の「言語方針」セクションを参照してください。

簡潔に：
- **Git コミット・コードコメント・ドキュメント**: すべて日本語
- **スキルのフォーマット**: 各スキルに従いながら、記述は日本語
