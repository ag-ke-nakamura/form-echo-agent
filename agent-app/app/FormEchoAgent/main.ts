/*
  トレースの配線（#213）。**この import は他のどれよりも先に置く** — グローバルの
  TracerProvider をここで登録し、Strands はそれを黙って使う（`setupTracer()` は呼ばない）。
  後ろに置くと Agent の生成が provider の登録より先に走りうる。

  なぜ `agentcore.json` の `instrumentation.enableOtel` で代替できないのか、送信先が
  何で切り替わるのかは `.claude/rules/agent-app.md`。
*/
import '@aws/aws-distro-opentelemetry-node-autoinstrumentation/register';
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
