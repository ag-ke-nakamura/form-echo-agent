import { describe, expect, it } from 'vitest';
import { WEB_SEARCH_MAX_CALLS } from '../config.js';
import {
  createWebSearchTool,
  toCitations,
  type WebSearchBackend,
  type WebSearchHit,
  webSearchesUsed,
  webSearchHits,
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

  /*
    出典番号（#174、ADR-0019）。**モデルが URL を書き写さずに根拠を指せることが
    この番号の存在理由**なので、番号の振り方が壊れると経路候補の根拠が全部ずれる。
    番号の並びは `toCitations` が持つ1つの並び（応答の `citations` と同じもの）。
  */
  describe('出典番号', () => {
    it('1始まりで、結果の並びに振る', async () => {
      const tool = createWebSearchTool(
        recordingBackend([
          hit({ url: 'https://www.example.jp/a' }),
          hit({ url: 'https://www.example.jp/b' }),
        ]),
      );

      const result = await withWebSearchBudget(() => callTool(tool, '経路'));

      expect(result).toMatchObject({
        results: [
          { url: 'https://www.example.jp/a', citation_number: 1 },
          { url: 'https://www.example.jp/b', citation_number: 2 },
        ],
      });
    });

    it('2回目の検索には続きの番号を振る', async () => {
      const first = createWebSearchTool(
        recordingBackend([hit({ url: 'https://www.example.jp/a' })]),
      );
      const second = createWebSearchTool(
        recordingBackend([hit({ url: 'https://www.example.jp/b' })]),
      );

      const results = await withWebSearchBudget(async () => [
        await callTool(first, '経路1'),
        await callTool(second, '経路2'),
      ]);

      // 番号はリクエスト単位で通し。検索ごとに1へ戻すと、2回目の結果を指した
      // 候補が1回目のページを指すことになる。
      expect(results[1]).toMatchObject({
        results: [{ url: 'https://www.example.jp/b', citation_number: 2 }],
      });
    });

    it('正規化して同じになる URL は1つの番号にまとめる', async () => {
      const tool = createWebSearchTool(
        recordingBackend([
          hit({ url: 'https://www.example.jp/a' }),
          hit({ url: 'https://WWW.Example.jp:443/a' }),
          hit({ url: 'https://www.example.jp/b' }),
        ]),
      );

      const result = await withWebSearchBudget(() => callTool(tool, '経路'));

      // 画面は `new URL().href` で重複を落とすので、ここで2件のまま残すと
      // 番号2が画面で引けなくなる（実在するページを指した候補が確認できなくなる）。
      expect(result).toMatchObject({
        results: [
          { citation_number: 1 },
          { citation_number: 1 },
          { citation_number: 2 },
        ],
      });
    });

    it('同じページが再び返ったら初出の番号になる', async () => {
      const backend = recordingBackend([
        hit({ url: 'https://www.example.jp/a' }),
      ]);
      const tool = createWebSearchTool(backend);

      const results = await withWebSearchBudget(async () => [
        await callTool(tool, '経路1'),
        await callTool(tool, '経路2'),
      ]);

      // 応答の `citations` は URL で重複を落とすので、番号もその並びに合わせる。
      // 合わせないと、職員が見る一覧に無い番号を候補が指す。
      expect(results[1]).toMatchObject({
        results: [{ url: 'https://www.example.jp/a', citation_number: 1 }],
      });
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

/**
 * 応答封筒に載る出典（`citations`。#46・#202）。**境界越しには言えない** — 境界の出力に
 * 出るのは出来上がった一覧だけで、それが本当に取得した結果から来ているのか、モデルが
 * 書いた `sources` から来ているのかを区別できない。
 *
 * 交通ICと検証ドメインの2ドメインが同じものを引く（ADR-0020）。**両者で違うのは
 * 番号を画面に出すかどうかだけ**で、一覧そのものはこの1つの関数が作る。
 */
describe('toCitations', () => {
  it('出典（タイトル）とリンクだけを残し、本文は落とす', () => {
    const citations = toCitations([
      hit({ publishedDate: '2026-08-27' }),
      hit({ url: 'https://www.example.jp/fare', title: '運賃表' }),
    ]);

    // 表示の義務が掛かっているのは出典とリンクであって本文ではない。載せると
    // 応答が1件あたり数千字ぶん太る。
    expect(citations).toEqual([
      {
        title: '東京から新大阪 時刻表',
        url: 'https://www.example.jp/diagram',
        publishedDate: '2026-08-27',
      },
      { title: '運賃表', url: 'https://www.example.jp/fare' },
    ]);
  });

  it('タイトルが空の結果は URL で代える', () => {
    const citations = toCitations([hit({ title: '  ' })]);

    // 出典の欄が空のリンクは、職員にはどこの情報か分からない。
    expect(citations).toEqual([
      {
        title: 'https://www.example.jp/diagram',
        url: 'https://www.example.jp/diagram',
      },
    ]);
  });

  it('正規化して同じになる URL は初出の1件にまとめる', () => {
    const citations = toCitations([
      hit({ url: 'https://www.example.jp/a', title: '初出' }),
      hit({ url: 'https://WWW.Example.jp:443/a', title: '同じページ' }),
    ]);

    // 画面も `new URL().href` で重複を落とすので、ここで2件残すと出典番号が
    // 画面で引けなくなる（#174）。
    expect(citations).toEqual([
      { title: '初出', url: 'https://www.example.jp/a' },
    ]);
  });

  it('上限を超えて検索できなかった分は出典に載らない', async () => {
    // クエリごとに別のページを返す。上限が効いた回に一覧がどこまで伸びるかを見る。
    const tool = createWebSearchTool(async (query) => [
      hit({ url: `https://www.example.jp/${encodeURIComponent(query)}` }),
    ]);

    const citations = await withWebSearchBudget(async () => {
      for (let i = 0; i <= WEB_SEARCH_MAX_CALLS; i++) {
        await callTool(tool, `クエリ${i}`);
      }
      return toCitations(webSearchHits());
    });

    // **出典は実際に取得した結果そのもの**なので、断った検索のページは載らない。
    // 上限（`WEB_SEARCH_MAX_CALLS`）は交通ICと検証ドメインで共有する1つの予算で、
    // 張るのは `invokeTask` がリクエスト全体を包む1箇所だけである。
    expect(citations).toHaveLength(WEB_SEARCH_MAX_CALLS);
    expect(citations.at(-1)?.url).toContain(
      encodeURIComponent(`クエリ${WEB_SEARCH_MAX_CALLS - 1}`),
    );
  });
});
