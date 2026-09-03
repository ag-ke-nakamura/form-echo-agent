import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { handleInvocation } from './invocation/handler.js';

/**
 * Runtime のエントリポイント。
 *
 * `requestSchema` は渡さない。リクエストの検査は `handleInvocation` が行う
 * （理由は `invocation/handler.ts`）。
 */
const app = new BedrockAgentCoreApp({
  invocationHandler: { process: handleInvocation },
});

app.run({ port: Number.parseInt(process.env.PORT ?? '8080', 10) });
