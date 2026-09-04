import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { AWS_REGION } from '../config.js';

/**
 * 案A（`invoke-checks.ts`）と案B（`apply-guardrail.ts`）で共有する `BedrockRuntimeClient`。
 *
 * HTTP/1.1 を明示する。`@aws-sdk/client-bedrock-runtime` は双方向ストリーミングの
 * API を持つため、クライアント全体の既定リクエストハンドラが `NodeHttp2Handler`
 * になっている。開発機のネットワークが Bedrock へ HTTP/2 を張れず
 * `ERR_HTTP2_ERROR: Protocol error` になる事例を実際に踏んだ（`model/load.ts` が
 * `BedrockModel` に対して同じ手当てを行っているのと同じ理由）。ここで両方式が
 * 生成するクライアントを1箇所にまとめ、次に3つ目の呼び出し元が増えても
 * この手当てを書き忘れないようにする。
 */
let client: BedrockRuntimeClient | undefined;

export function bedrockRuntimeClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({
    region: AWS_REGION,
    requestHandler: new NodeHttpHandler(),
  });
  return client;
}
