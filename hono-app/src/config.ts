/** BFF の設定。すべて環境変数から読み、再ビルドせずに切り替えられるようにする。 */

export const PORT = Number(process.env.PORT ?? 8787)

/** ローカルの Runtime（`agentcore dev`）の宛先。 */
export const RUNTIME_URL =
  process.env.FORMECHO_RUNTIME_URL ?? 'http://localhost:8080'

/** 参照ドキュメント 11.1節が Runtime 障害の検知に使うタイムアウト。 */
export const RUNTIME_TIMEOUT_MS = Number(
  process.env.FORMECHO_RUNTIME_TIMEOUT_MS ?? 60_000,
)

/**
 * CORS の許可オリジン。デプロイ済み検証環境はオリジンが CloudFront 1つなので
 * **実質効かない**（ADR-0014、`docs/architecture.md` §8）。それでも消さないのは、
 * ローカルが :3000 → :8787 の2オリジンのままだから。
 */
export const ALLOWED_ORIGINS = (
  process.env.FORMECHO_ALLOWED_ORIGINS ?? 'http://localhost:3000'
).split(',')

/**
 * Runtime クライアントの実装（#23 の決定性の確保、#41、#45）。
 *
 * `local` は `agentcore dev` が立てたローカルの Runtime を HTTP で叩く。`deployed` は
 * デプロイ済み Runtime を SigV4 で叩く（`InvokeAgentRuntime`）。実装の置き場所は
 * `lib/runtime-transport.ts`。
 *
 * WHY: テストのために新しいシームを作らず、既にある切り替え口に選択肢を1つ足す。
 * Runtime 側でモデルを `fake` に差し替えたのと同じ発想で、テストと実測は同じ
 * HTTP 境界を通り、違うのは設定だけになる。
 */
export const FAKE_RUNTIME_CLIENT_NAME = 'fake'
export const DEPLOYED_RUNTIME_CLIENT_NAME = 'deployed'

export type RuntimeClientName =
  | 'local'
  | typeof FAKE_RUNTIME_CLIENT_NAME
  | typeof DEPLOYED_RUNTIME_CLIENT_NAME

const RUNTIME_CLIENT_NAMES: readonly RuntimeClientName[] = [
  'local',
  FAKE_RUNTIME_CLIENT_NAME,
  DEPLOYED_RUNTIME_CLIENT_NAME,
]

/**
 * デプロイ済み Runtime の ARN。`FORMECHO_RUNTIME_CLIENT=deployed` のときだけ要る。
 * region はここから実装側（`lib/runtime-transport.ts`）がパースする — 専用の env は増やさない。
 */
export const RUNTIME_ARN = process.env.FORMECHO_RUNTIME_ARN ?? ''

export function resolveRuntimeClientName(): RuntimeClientName {
  const name = process.env.FORMECHO_RUNTIME_CLIENT ?? 'local'
  if (!(RUNTIME_CLIENT_NAMES as readonly string[]).includes(name)) {
    throw new Error(
      `FORMECHO_RUNTIME_CLIENT は ${RUNTIME_CLIENT_NAMES.join(' / ')} のいずれかにしてください（受け取った値: ${name}）`,
    )
  }
  // ARN が無いまま deployed を選ぶと、失敗するのは最初のリクエストの時になり
  // RUNTIME_UNAVAILABLE として出て区別が付かない。他の設定ミスと同じく起動時に落とす。
  //
  // `RUNTIME_ARN` 定数ではなく `process.env` を直接見る。`name` と同じく、
  // テストが実行中に立てる値を拾えないと検査にならない。
  if (
    name === DEPLOYED_RUNTIME_CLIENT_NAME &&
    !process.env.FORMECHO_RUNTIME_ARN
  ) {
    throw new Error(
      'FORMECHO_RUNTIME_CLIENT=deployed には FORMECHO_RUNTIME_ARN の指定が要ります。',
    )
  }
  return name as RuntimeClientName
}
