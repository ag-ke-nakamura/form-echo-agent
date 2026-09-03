/**
 * invocation 境界が要求するロガーの最小の形。
 *
 * WHY: 境界の内側で要るのは警告を1本残すことだけで、`RequestContext['log']`
 * （fastify の pino）そのものではない。最小の形に留めれば、テストと実測が
 * HTTP リクエストを組み立てずにこの境界を呼べる。fastify のロガーはこの形を
 * 構造的に満たすので、ハンドラは `context.log` をそのまま渡せる。
 */
export interface InvocationLogger {
  warn(details: object, message: string): void;
}
