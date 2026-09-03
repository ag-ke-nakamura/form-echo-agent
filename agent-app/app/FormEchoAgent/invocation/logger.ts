/**
 * invocation 境界が要求するロガーの最小の形。
 *
 * WHY: 境界の内側で要るのは警告と失敗を1本ずつ残すことだけで、
 * `RequestContext['log']`（fastify の pino）そのものではない。最小の形に留めれば、
 * テストと実測が HTTP リクエストを組み立てずにこの境界を呼べる。fastify の
 * ロガーはこの形を構造的に満たすので、ハンドラは `context.log` をそのまま渡せる。
 */
export interface InvocationLogger {
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}
