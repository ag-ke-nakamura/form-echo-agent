import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { signedFetch } from '../aws/signed-fetch.js';
import type { WebSearchBackend, WebSearchHit } from './web-search.js';

/**
 * AgentCore Gateway を MCP で叩く（#46）。
 *
 * Gateway の authorizer は `AWS_IAM` なので、リクエストは SigV4 で署名する。
 * **Strands の `McpClient` は SigV4 を持たない**（`auth` は OAuth のクライアント
 * クレデンシャル、`headers` は固定値）ので、署名する `fetch` を差した MCP の
 * トランスポートを自分で組む。
 *
 * サービス名は `bedrock-agentcore`。認可は Gateway 側のロールが持つ
 * `bedrock-agentcore:InvokeWebSearch`（`arn:aws:bedrock-agentcore:ap-northeast-1:aws:tool/web-search.v1`）
 * に閉じており、呼ぶ側に要るのは Gateway を叩く権限だけである。
 */

/**
 * Gateway が公開するツールの名前。`<ターゲット名>___<ツール名>` で組まれる。
 *
 * `agentcore.json` の `targets[].name` と `configurations[].name` がともに
 * `WebSearch` なので、この形になる。片方を変えるとここも変わる。
 */
const GATEWAY_TOOL_NAME = 'WebSearch___WebSearch';

/** 1回の検索で受け取る件数。裏取りには上位数件で足り、多いほど本文が積み上がる。 */
const MAX_RESULTS = 5;

/** Gateway が返す本文（JSON 文字列）から、必要なフィールドだけを取る。 */
function parseHits(payload: unknown): WebSearchHit[] {
  const content = (payload as { content?: { text?: string }[] }).content ?? [];
  return content.flatMap((block) => {
    if (typeof block.text !== 'string') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      // Gateway が JSON でない本文を返したら、その1ブロックだけ捨てる。
      return [];
    }
    const results = (parsed as { results?: unknown }).results;
    if (!Array.isArray(results)) return [];
    return results.flatMap((found: unknown): WebSearchHit[] => {
      const { title, url, text, publishedDate } = found as Record<
        string,
        unknown
      >;
      // url の無い結果は落とす。`sources` に載せられず、裏取りの証拠にならない。
      if (typeof url !== 'string') return [];
      return [
        {
          title: typeof title === 'string' ? title : url,
          url,
          text: typeof text === 'string' ? text : '',
          // コネクタは分からないときに 'unknown' という文字列を入れてくる。
          // そのまま渡すと日付として読まれるので、持っていないことにする。
          ...(typeof publishedDate === 'string' && publishedDate !== 'unknown'
            ? { publishedDate }
            : {}),
        },
      ];
    });
  });
}

/**
 * Gateway に接続する検索。**接続は呼ばれたときに張り、その場で閉じる。**
 *
 * 張りっぱなしにすると、Web 検索を1回も使わないリクエスト（交通ICでも経路を
 * 尋ねない指示は多い）でも接続を持つことになる。1リクエストあたり最大3回なので、
 * 使い回して得られるものより、寿命を呼び出しの中に閉じ込められる利点が勝つ。
 */
export function gatewayWebSearch(gatewayUrl: string): WebSearchBackend {
  const fetchImpl = signedFetch('bedrock-agentcore');

  return async (query) => {
    const client = new Client({ name: 'FormEchoAgent', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl), {
      fetch: fetchImpl,
    });
    try {
      await client.connect(transport);
      const payload = await client.callTool({
        name: GATEWAY_TOOL_NAME,
        arguments: { query, maxResults: MAX_RESULTS },
      });
      return parseHits(payload);
    } finally {
      await client.close().catch(() => {
        // 後片付けの失敗で検索結果を捨てない。
      });
    }
  };
}
