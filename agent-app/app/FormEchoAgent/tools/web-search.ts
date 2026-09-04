import { AsyncLocalStorage } from 'node:async_hooks';
import { type InvokableTool, tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { WEB_SEARCH_MAX_CALLS } from '../config.js';

/**
 * 交通ICドメインエージェントが持つ Web 検索（#46）。
 *
 * **目的は回答（経路探索）そのものの精度**であって `sources` を埋めることではない
 * （`docs/reference-doc-fixes.md` F-22）。経路・所要時間・列車名をモデルの内部知識だけで
 * 答えさせると、古いダイヤや存在しない便を答える。裏を取る手段をここで渡し、参照元を
 * `sources` に載せるのはその結果として付いてくる透明性の仕組みである。
 *
 * 会議ロジドメインエージェントには渡さない。渡す・渡さないの判断は `tools/load.ts`。
 */

/** 検索結果1件。Gateway の Web Search コネクタが返す形から必要な分だけを取る。 */
export interface WebSearchHit {
  title: string;
  url: string;
  text: string;
  /**
   * ページの公開日。コネクタが持っていなければ省く。
   *
   * WHY 渡すか: 裏取りの相手がダイヤ改正で変わる情報なので、**いつのページか**が
   * 結果の重みを決める。落とすと、モデルは何年前の時刻表かを知らないまま
   * 「検索結果に書いてある」として答えることになる。
   */
  publishedDate?: string;
}

/**
 * 実際に検索する相手。既定は AgentCore Gateway（`gateway.ts`）。
 *
 * WHY 差し替え可能にするか: `loadModel()` が fake を選ぶのと同じ理由で、上限・失敗の
 * 切り離し・切り詰めの検証に実物の Gateway を要らなくする。選ぶのは `tools/load.ts`
 * だけなので、呼び出し側から見た境界は増えていない。
 */
export type WebSearchBackend = (query: string) => Promise<WebSearchHit[]>;

/**
 * 1リクエストが使える検索回数の残り。
 *
 * WHY `AsyncLocalStorage` か: 上限は**リクエスト単位**（共通設計方針書 7.1節）だが、
 * 数える場所の候補はどれも単位が合わない。ツールの `invocationState` は
 * `agent.invoke` ごとに戻るので、Structured Output の作り直し（`structured-output.ts`
 * が最大2回まわす）で予算が復活する。Agent に持たせると (セッション, taskId) 単位に
 * なり、同じタブの次のリクエストへ残高が持ち越される。モジュール変数の素の数値は
 * 同時に走るリクエストどうしで混ざる。リクエストの実行文脈に紐づくものは、
 * その文脈に置くのが一番素直になる。
 */
interface RequestBudget {
  remaining: number;
  /**
   * このリクエストで実際にモデルへ渡した検索結果。
   *
   * WHY 溜めるか: 「検索結果に無い列車名・所要時間を答えていない」は、**答えと
   * 検索結果を突き合わせないと言えない**（#46 の受け入れ条件）。後から同じクエリを
   * 投げ直しても、検索結果は毎回同じではないので突き合わせにならない。
   */
  hits: WebSearchHit[];
}

const budget = new AsyncLocalStorage<RequestBudget>();

/**
 * 1リクエスト分の検索予算を張る。`invokeTask` が全体をこれで包む。
 *
 * 張り忘れても例外にはしない（ツール側が検索を諦める）。配線の誤りを職員の
 * リクエストの失敗として見せない。
 */
export function withWebSearchBudget<T>(fn: () => Promise<T>): Promise<T> {
  return budget.run({ remaining: WEB_SEARCH_MAX_CALLS, hits: [] }, fn);
}

/**
 * このリクエストがここまでに使った検索回数。予算の外なら `null`。
 *
 * 従量課金の外部呼び出しなので、何回使ったかは実測でも運用でも見たい数字になる。
 * 予算そのものを公開せず使った回数だけを返すのは、読む側が残高から引き算して
 * 上限を再実装しないため。
 */
export function webSearchesUsed(): number | null {
  const store = budget.getStore();
  return store === undefined ? null : WEB_SEARCH_MAX_CALLS - store.remaining;
}

/**
 * このリクエストでモデルへ渡した検索結果。予算の外なら空。
 *
 * 実測が「答えが検索結果に紐づいているか」を突き合わせるために引く。応答本文には
 * 載せない（職員に見せるのは `sources` の URL であって本文ではない）。
 */
export function webSearchHits(): readonly WebSearchHit[] {
  return budget.getStore()?.hits ?? [];
}

/** 残高を1つ使う。使えたら true。 */
function spend(): boolean {
  const store = budget.getStore();
  if (store === undefined || store.remaining <= 0) return false;
  store.remaining -= 1;
  return true;
}

/**
 * 検索結果1件の本文の上限。
 *
 * **一度 800 字にして失敗している。** 時刻表ページは1件 2,300 字前後で、800 字で
 * 切ると号数と発着時刻の対の3分の1しか渡らない（実測: 35件 → 12件、39件 → 13件）。
 * すると**モデルは「表を見たが自分の欲しい時間帯の便が無い」状態になり、内部知識で
 * 号数を作る** — 実際「のぞみ247号（09:21発）」という、どの検索結果にも存在しない
 * 便を答えた。切り詰めは節約ではなく、裏取りの穴になっていた。
 *
 * 上限そのものは要る（本文の無い上限だと1件で会話履歴を埋めうる）ので、実測した
 * ページ長に対して表が丸ごと入る側へ置く。
 */
const MAX_HIT_TEXT_LENGTH = 3_000;

/** モデルに返す全体。検索できなかったときも同じ形で返す（`note` が理由を言う）。 */
interface WebSearchToolResult {
  /** `url` は `sources` に載せる値でもある。本文だけが切り詰められている。 */
  results: WebSearchHit[];
  note?: string;
}

function truncate(text: string): string {
  return text.length <= MAX_HIT_TEXT_LENGTH
    ? text
    : `${text.slice(0, MAX_HIT_TEXT_LENGTH)}…`;
}

const inputSchema = z.object({
  query: z
    .string()
    .describe(
      '検索クエリ。経路を裏取りするなら出発駅・到着駅・交通手段を含める（例: 東京駅 新大阪駅 新幹線 所要時間）',
    ),
});

export function createWebSearchTool(
  search: WebSearchBackend,
): InvokableTool<{ query: string }, WebSearchToolResult> {
  return tool({
    name: 'web_search',
    /*
      **Skill と同じことを言う。** ここと `skills/ic-card/parse-reservation/SKILL.md` は
      どちらもモデルに届くので、食い違うと逆の指示が2つ渡ることになる。以前ここは
      「返ってきた url は sources に載せること」と書いており、Skill の「根拠にした
      ものだけを入れる」と矛盾していた。
    */
    description: [
      '経路・所要時間・列車名など、最新の外部情報を Web 検索で裏取りする。',
      `1回のリクエストで ${WEB_SEARCH_MAX_CALLS} 回まで使える。`,
      '結果の text に書かれていない列車名・号数・所要時間を答えてはいけない。',
      '実際に答えの根拠にした結果の url だけを出力の sources に入れる。',
    ].join(''),
    inputSchema,
    callback: async ({ query }): Promise<WebSearchToolResult> => {
      if (!spend()) {
        return {
          results: [],
          note: `このリクエストで使える検索回数（${WEB_SEARCH_MAX_CALLS}回）を使い切りました。ここまでに得た情報だけで答えてください。`,
        };
      }
      try {
        const results = (await search(query)).map((found) => ({
          ...found,
          text: truncate(found.text),
        }));
        // 切り詰めた後のものを控える。モデルが読んだのはこちらなので、
        // 突き合わせの相手も同じでなければ意味がない。
        budget.getStore()?.hits.push(...results);
        return { results };
      } catch {
        /*
          失敗を握り潰して結果の形で返す。投げるとツールの失敗が Agent の失敗になり、
          抽出結果ごと返らなくなる — 検索は精度を上げるためのもので、フォームを埋める
          経路を止めない（#46）。何が起きたかはモデルに伝える（黙って空を返すと、
          モデルは「検索したが何も無かった」と読んで内部知識で埋めにいく）。
        */
        return {
          results: [],
          note: 'Web 検索できませんでした。経路・所要時間・列車名は答えず、抽出できた項目だけを返してください。',
        };
      }
    },
  });
}
