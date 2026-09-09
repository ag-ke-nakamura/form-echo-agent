import { handle } from 'hono/aws-lambda'
import { app } from './index.js'

/**
 * Lambda（Node 22 のマネージドランタイム）のエントリ（#139）。
 *
 * WHY 既存の Bun 向けエントリ（`src/index.ts` の default export）を置き換えないか:
 * ローカル開発は `bun run --hot` のままにしておきたい。名前付き export された `app`
 * を Hono のアダプタに渡すだけなので、我々の判断はこのファイルに1つも入らない —
 * ルーティング・認証・エラーの写像はすべて `src/index.ts` の側に残る。
 *
 * 宛先（Function URL）は CloudFront の `/api/*` behavior にパス透過で繋がるので、
 * `/api/ai/tasks` はそのまま届く。BFF 側のルーティング改修は0行。
 */
export const handler = handle(app)
