# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A minimal [Hono](https://hono.dev) web application running on the [Bun](https://bun.sh) runtime. The app is currently a bare scaffold (`src/index.ts`) with a single route.

## Commands

- Install dependencies: `bun install`
- Run the dev server (hot reload): `bun run dev` — serves at http://localhost:3000

There is no build, lint, or test setup configured yet.

## Architecture

- `src/index.ts` is the entire application: it creates a `Hono` app instance and exports it as the default export. Bun's runtime picks up this default export to serve HTTP requests — there is no separate server-listen call.
- `tsconfig.json` sets `jsxImportSource` to `hono/jsx`, so JSX in this project (if added) compiles to Hono's own JSX runtime, not React's.

## 言語方針

本プロジェクト（FormEcho 全体）は**日本語を基本言語**として運用します。詳細は `../CLAUDE.md` の「言語方針」セクションを参照してください。

簡潔に：
- **Git コミットメッセージ**: 日本語で簡潔に記述
- **コードコメント**: 複雑なロジックは日本語で WHY を説明
- **ドキュメント**: README、設計ドキュメントは日本語
