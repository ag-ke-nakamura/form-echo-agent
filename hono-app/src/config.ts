/** BFF の設定。すべて環境変数から読み、再ビルドせずに切り替えられるようにする。 */

export const PORT = Number(process.env.PORT ?? 8787)

/**
 * Runtime の宛先。
 *
 * `agentcore dev` が立てるローカルの HTTP を既定にする。デプロイ済み Runtime を
 * SigV4 で叩く経路（`InvokeAgentRuntime`）は、デプロイ先を設定するチケットで
 * このモジュールに足す。
 */
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
