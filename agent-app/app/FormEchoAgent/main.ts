import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { handleInvocation } from './invocation/handler.js';
import { setupTracing } from './telemetry/load.js';

/**
 * Runtime のエントリポイント。
 *
 * `requestSchema` は渡さない。リクエストの検査は `handleInvocation` が行う
 * （理由は `invocation/handler.ts`）。
 */

// Agent を作る前に済ませる（#213）。Strands は生成時ではなく span を張る時点で
// グローバルの provider を引くが、先に置くほうが依存関係が読み取れる。
setupTracing();

const app = new BedrockAgentCoreApp({
  invocationHandler: { process: handleInvocation },
});

app.run({ port: Number.parseInt(process.env.PORT ?? '8080', 10) });
