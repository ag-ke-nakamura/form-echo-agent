/*
  トレースの配線（#213）。**この import は他のどれよりも先に置く** — グローバルの
  TracerProvider をここで登録し、Strands はそれを黙って使う（自前で `setupTracer()` は
  呼ばない）。後ろに置くと Agent 生成が provider 登録より先に走りうる。

  `agentcore.json` の `instrumentation.enableOtel` ではこれを代替できない。あのフラグは
  entrypoint を `opentelemetry-instrument` で包むためのもので、@aws/agentcore-cdk が
  Python にしか適用しない（alpha.53 時点で `enableOtel && !isNode`）。

  送信先・サンプラー・GenAI の本文取得は全て `AGENT_OBSERVABILITY_ENABLED` で切り替わる。
  **未設定なら何も送らない**ので、ローカルの `agentcore dev` は素のまま動く。有効側は
  `agentcore.json` の envVars が持つ。
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
