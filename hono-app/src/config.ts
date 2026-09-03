/** BFF の設定。すべて環境変数から読み、再ビルドせずに切り替えられるようにする。 */

export const PORT = Number(process.env.PORT ?? 8787)

/** ローカルの Runtime（`agentcore dev`）の宛先。 */
export const RUNTIME_URL =
  process.env.FORMECHO_RUNTIME_URL ?? 'http://localhost:8080'

/** 参照ドキュメント 11.1節が Runtime 障害の検知に使うタイムアウト。 */
export const RUNTIME_TIMEOUT_MS = Number(
  process.env.FORMECHO_RUNTIME_TIMEOUT_MS ?? 60_000,
)

/** フロントエンドは SSG なので、ブラウザからこの BFF を直接叩く。 */
export const ALLOWED_ORIGINS = (
  process.env.FORMECHO_ALLOWED_ORIGINS ?? 'http://localhost:3000'
).split(',')

/**
 * Runtime クライアントの実装（#23 の決定性の確保、#41）。
 *
 * `local` は `agentcore dev` が立てたローカルの Runtime を HTTP で叩く。デプロイ済み
 * Runtime を SigV4 で叩く経路（`InvokeAgentRuntime`）は `deployed` としてここに足す。
 * 実装の置き場所は `lib/runtime-transport.ts`。
 *
 * WHY: テストのために新しいシームを作らず、既にある切り替え口に選択肢を1つ足す。
 * Runtime 側でモデルを `fake` に差し替えたのと同じ発想で、テストと実測は同じ
 * HTTP 境界を通り、違うのは設定だけになる。
 */
export const FAKE_RUNTIME_CLIENT_NAME = 'fake'

export type RuntimeClientName = 'local' | typeof FAKE_RUNTIME_CLIENT_NAME

const RUNTIME_CLIENT_NAMES: readonly RuntimeClientName[] = [
  'local',
  FAKE_RUNTIME_CLIENT_NAME,
]

export function resolveRuntimeClientName(): RuntimeClientName {
  const name = process.env.FORMECHO_RUNTIME_CLIENT ?? 'local'
  if ((RUNTIME_CLIENT_NAMES as readonly string[]).includes(name)) {
    return name as RuntimeClientName
  }
  throw new Error(
    `FORMECHO_RUNTIME_CLIENT は ${RUNTIME_CLIENT_NAMES.join(' / ')} のいずれかにしてください（受け取った値: ${name}）`,
  )
}
