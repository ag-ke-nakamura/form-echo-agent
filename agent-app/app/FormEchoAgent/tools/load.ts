import type { Tool } from '@strands-agents/sdk';
import { resolveWebSearchGatewayUrl } from '../config.js';
import type { Domain } from '../contracts/index.js';
import { gatewayWebSearch } from './gateway.js';
import { createWebSearchTool } from './web-search.js';

/**
 * ドメインエージェントが持つツール（#46）。`model/load.ts` と同じく、設定を見て
 * 実物を組む場所であり、判断はここに閉じる。
 *
 * **会議ロジには Web 検索を渡さない**（`docs/reference-doc-fixes.md` F-22）。共通設計
 * 方針書 7.1節・14.2節は候補日程設定と候補日提案も Websearch の利用機能として
 * 挙げているが、どちらも自然文の解釈と候補の生成であって、裏を取る対象になる
 * 外部の最新情報を持たない。**会議ロジに渡さないこと自体が #46 の成果に含まれる**
 * ので、空配列を「まだ足していない」ではなく「足さないと決めた」として書き下す。
 *
 * 検証ドメインは持つ（ADR-0020）。検索を使わせるプロンプトの効きを試せることが
 * この画面の値打ちの1つで、上限（`WEB_SEARCH_MAX_CALLS`）は交通ICと同じ予算を
 * `invokeTask` の側で共有する。
 */
const DOMAIN_TOOLS: Record<Domain, () => Tool[]> = {
  'ic-card': webSearchTools,
  meeting: () => [],
  playground: webSearchTools,
};

function webSearchTools(): Tool[] {
  const gatewayUrl = resolveWebSearchGatewayUrl();
  // 未設定なら持たない。実測は Websearch 有効／無効を同じ入力セットで比べるので、
  // 無効側は「ツールが無い」状態そのものになる（プロンプトで禁じるのではなく）。
  if (gatewayUrl === null) return [];
  return [createWebSearchTool(gatewayWebSearch(gatewayUrl))];
}

export function loadDomainTools(domain: Domain): Tool[] {
  return DOMAIN_TOOLS[domain]();
}
