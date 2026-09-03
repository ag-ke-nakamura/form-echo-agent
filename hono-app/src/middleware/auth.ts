import type { MiddlewareHandler } from 'hono'

/**
 * 認証の差し込み口。
 *
 * 本番では GSS / Entra が発行した JWT の検証とテナント（府省）の識別がここに入る。
 * 相手が決まっていて検証の余地がないため、この検証環境では素通しにしてある。
 * 中身を実装するときはこのミドルウェアを差し替えるだけで済むよう、経路だけ通しておく。
 */
export const authenticate: MiddlewareHandler = (_c, next) => next()
