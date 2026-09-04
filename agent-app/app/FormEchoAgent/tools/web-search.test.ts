import { describe, expect, it } from 'vitest';
import { WEB_SEARCH_MAX_CALLS } from '../config.js';
import {
  createWebSearchTool,
  type WebSearchBackend,
  type WebSearchHit,
  webSearchesUsed,
  withWebSearchBudget,
} from './web-search.js';

/**
 * Web 検索ツール（#46）。**守るのは配線・上限・失敗の切り離しであって、検索結果の
 * 良し悪しではない**（#23 の線引き）。結果の質は実測の対象で、ここでは扱わない。
 *
 * 実物の Gateway は叩かない。叩く相手（`WebSearchBackend`）を差し替えるのは
 * `loadModel()` が fake を選ぶのと同じ考えで、テストのために新しい境界を作っては
 * いない — 配線の選択はどちらも `tools/load.ts` に閉じている。
 */

function hit(overrides: Partial<WebSearchHit> = {}): WebSearchHit {
  return {
    title: '東京から新大阪 時刻表',
    url: 'https://www.example.jp/diagram',
    text: 'のぞみ号の所要時間は2時間21分です。',
    ...overrides,
  };
}

/** 呼ばれた回数とクエリを記録する差し替え。 */
function recordingBackend(hits: WebSearchHit[] = [hit()]): WebSearchBackend & {
  queries: string[];
} {
  const queries: string[] = [];
  return Object.assign(
    async (query: string) => {
      queries.push(query);
      return hits;
    },
    { queries },
  );
}

/** ツールを1回呼ぶ。ツールの実体は Strands の `InvokableTool`。 */
async function callTool(
  tool: ReturnType<typeof createWebSearchTool>,
  query: string,
): Promise<unknown> {
  return tool.invoke({ query });
}

describe('createWebSearchTool', () => {
  it('検索結果を参照元 URL 付きで返す', async () => {
    const backend = recordingBackend();
    const tool = createWebSearchTool(backend);

    const result = await withWebSearchBudget(() =>
      callTool(tool, '東京 新大阪 新幹線'),
    );

    expect(backend.queries).toEqual(['東京 新大阪 新幹線']);
    expect(result).toMatchObject({
      results: [{ url: 'https://www.example.jp/diagram' }],
    });
  });

  it(`1リクエストあたり ${WEB_SEARCH_MAX_CALLS} 回を超えて検索しない`, async () => {
    const backend = recordingBackend();
    const tool = createWebSearchTool(backend);

    const results = await withWebSearchBudget(async () => {
      const collected: unknown[] = [];
      for (let i = 0; i <= WEB_SEARCH_MAX_CALLS; i++) {
        collected.push(await callTool(tool, `クエリ${i}`));
      }
      return collected;
    });

    // 上限を超えた分は Gateway へ飛ばさない。課金は呼んだ回数に付くので、
    // 断る判断はモデルではなくこちら側に置く。
    expect(backend.queries).toHaveLength(WEB_SEARCH_MAX_CALLS);
    expect(results.at(-1)).toMatchObject({ results: [] });
  });

  it('上限は1リクエストごとに戻る', async () => {
    const backend = recordingBackend();
    const tool = createWebSearchTool(backend);

    for (let request = 0; request < 2; request++) {
      await withWebSearchBudget(async () => {
        for (let i = 0; i < WEB_SEARCH_MAX_CALLS; i++) {
          await callTool(tool, `クエリ${request}-${i}`);
        }
      });
    }

    expect(backend.queries).toHaveLength(WEB_SEARCH_MAX_CALLS * 2);
  });

  it('検索が失敗しても例外にせず、失敗したことを返す', async () => {
    const tool = createWebSearchTool(async () => {
      throw new Error('Gateway に届きません');
    });

    const result = await withWebSearchBudget(() => callTool(tool, '東京 大阪'));

    // 検索は精度を上げるためのもので、フォームを埋める経路を止めない（#46）。
    // 投げるとツールの失敗が Agent の失敗になり、抽出結果ごと返らなくなる。
    expect(result).toMatchObject({ results: [] });
    expect(JSON.stringify(result)).toContain('検索できませんでした');
  });

  it('予算の外で呼ばれても例外にしない', async () => {
    const backend = recordingBackend();
    const tool = createWebSearchTool(backend);

    // 予算を張るのは `invokeTask` の仕事なので、張り忘れは配線の誤りである。
    // ただしその誤りを職員のリクエストの失敗として見せない — 検索を諦める。
    const result = await callTool(tool, '東京 大阪');

    expect(backend.queries).toEqual([]);
    expect(result).toMatchObject({ results: [] });
  });

  it('使った検索回数を数える', async () => {
    const tool = createWebSearchTool(recordingBackend());

    const used = await withWebSearchBudget(async () => {
      await callTool(tool, 'クエリ1');
      await callTool(tool, 'クエリ2');
      return webSearchesUsed();
    });

    expect(used).toBe(2);
    // 予算の外では数える対象が無い。0 を返すと「使わなかった」と区別が付かない。
    expect(webSearchesUsed()).toBeNull();
  });

  it('本文を切り詰めて返す', async () => {
    const tool = createWebSearchTool(async () => [
      hit({ text: 'あ'.repeat(10_000) }),
    ]);

    const result = (await withWebSearchBudget(() =>
      callTool(tool, '東京 大阪'),
    )) as { results: { text: string }[] };

    // 上限そのものは要る（無いと1件で会話履歴を埋めうる）。ただし時刻表ページが
    // 丸ごと入る側に置く — 短く切ると号数の対が落ちて、モデルが便を作る。
    expect(result.results[0]?.text.length).toBeLessThan(3_100);
    expect(result.results[0]?.text.length).toBeGreaterThan(2_500);
  });
});
