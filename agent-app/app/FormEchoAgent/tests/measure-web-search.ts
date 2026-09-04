import { invokeTask } from '../invocation/invoke-task.js';

/**
 * Websearch 有効／無効の同じ入力セットを通し、経路情報の精度差を記録する（#46）。
 *
 * **これが #46 の本体の成果**であって、`sources` が埋まることではない。テストと
 * 同じ invocation 境界を通り、違うのは設定だけにする（#23）— 有効側は
 * `FORMECHO_WEB_SEARCH_GATEWAY_URL` が立っているかどうかだけで決まる。
 *
 * 実行:
 *   FORMECHO_MODEL=sonnet npx tsx tests/measure-web-search.ts
 *
 * Gateway の URL は `agentcore deploy` の出力（`GatewayFormEchoWebSearchUrlOutput`）。
 * このファイルは `tsconfig.json` の `exclude` に入る `tests/` にあるので `dist/` には
 * 乗らない。`*.test.ts` ではないので vitest も拾わない。
 */

/**
 * 入力セット。**両モードで同じものを通す。**
 *
 * 4番目だけ経路を尋ねない。有効側でも `sources` が空のまま返ることを見るための
 * 対照で、「検索を使わなかったときは空配列」の確認がここに当たる。
 * 5番目は存在しない直通便を尋ねる — 内部知識だけで答えると「東京から札幌まで
 * 新幹線で N 時間」と作文する余地があり、裏取りの効きが一番出る。
 */
const INPUTS = [
  {
    id: 'tokyo-osaka',
    prompt:
      '来月15日9時から3泊4日で東京から大阪へ出張します。新幹線で往復、打ち合わせです。何号に乗ればよいですか。所要時間も教えてください。',
  },
  {
    id: 'tokyo-hakata',
    prompt:
      '東京から博多まで新幹線だと何時間かかりますか。来週20日の10時に借りて22日18時に返します。視察です。',
  },
  {
    id: 'nagoya-sendai',
    prompt:
      '名古屋から仙台へ新幹線で移動します。どの経路で何時間かかりますか。12月3日8時に借りて12月4日20時に返します。研修です。',
  },
  {
    id: 'no-route-question',
    prompt:
      '来月15日9時から3泊4日で大阪出張、新幹線で往復です。打ち合わせに行きます。',
  },
  {
    id: 'tokyo-sapporo',
    prompt:
      '東京から札幌まで新幹線の直通で何時間ですか。1月10日7時に借りて1月12日19時に返します。出張です。',
  },
] as const;

interface Observation {
  id: string;
  mode: 'enabled' | 'disabled';
  ok: boolean;
  message: string;
  sources: string[];
  /** `message` に現れた列車名。裏取りの効きを見る手がかり。 */
  trainNames: string[];
  /** `message` に現れた所要時間の表現。 */
  durations: string[];
  /** このリクエストが使った Web 検索の回数。上限は `WEB_SEARCH_MAX_CALLS`。 */
  webSearches: number;
  /**
   * 号数まで名指しした便のうち、**モデルが読んだ検索結果に実在したもの**。
   *
   * WHY 号数付きだけを見るか: 「のぞみ号」は列車の**種別**であって特定の便ではない。
   * 種別は路線の常識で、検索結果に無くても誤りではない。裏取りが要るのは
   * 「のぞみ247号（09:21発）」のように**職員が実際に乗ろうとする便**を名指しした
   * ときだけである。
   */
  groundedServices: string[];
  /** 号数まで名指ししたが検索結果に無かった便。**空であってほしい項目。** */
  ungroundedServices: string[];
  totalTokens: number;
  elapsedMs: number;
}

/** 新幹線・特急の列車名。表記ゆれを拾うため号数は別に取る。 */
const TRAIN_NAME_PATTERN =
  /(のぞみ|ひかり|こだま|みずほ|さくら|つばめ|はやぶさ|はやて|やまびこ|なすの|とき|かがやき|はくたか|あさま|つるぎ|こまち|つばさ|かもめ)\s*\d*\s*号?/g;
const DURATION_PATTERN =
  /(?:約)?\s*\d+\s*時間(?:\s*\d+\s*分)?|(?:約)?\s*\d+\s*分/g;

function matches(text: string, pattern: RegExp): string[] {
  return [...new Set(text.match(pattern) ?? [])].map((found) => found.trim());
}

async function observe(
  input: (typeof INPUTS)[number],
  mode: Observation['mode'],
): Promise<Observation> {
  const startedAt = Date.now();
  /*
    `handleInvocation` ではなく `invokeTask`（#23 のシームその1）を呼ぶ。テストが
    ハンドラを通すのは出力契約のエラーコードへの写像を見るためで、実測が要るのは
    検索回数（`webSearches`）— これは応答本文に載せないので境界の内側にしかない。
  */
  let invoked: Awaited<ReturnType<typeof invokeTask>>;
  try {
    invoked = await invokeTask(
      {
        taskId: 'ic-card.parse-reservation',
        prompt: input.prompt,
        // 入力ごとに別セッションにする。会話履歴が跨ると、2件目以降が
        // 1件目の検索結果を再利用してしまい、1件あたりの検索回数が測れない。
        sessionId: `measure-${mode}-${input.id}`,
      },
      {
        warn: (context, message) =>
          console.error('[warn]', message, JSON.stringify(context)),
        error: (context, message) =>
          console.error('[error]', message, JSON.stringify(context)),
      },
    );
  } catch (error) {
    // 1件の失敗で走り全体を捨てない。両モードを揃えて比べるのが目的なので、
    // 落ちた入力は落ちたと記録して残りを続ける。
    return {
      id: input.id,
      mode,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      sources: [],
      trainNames: [],
      durations: [],
      groundedServices: [],
      ungroundedServices: [],
      webSearches: 0,
      totalTokens: 0,
      elapsedMs: Date.now() - startedAt,
    };
  }
  const elapsedMs = Date.now() - startedAt;

  const result = invoked.result as { message: string; sources: string[] };
  const trainNames = matches(result.message, TRAIN_NAME_PATTERN);
  // 号数まで書かれているものだけが「この便に乗れ」という主張になる。
  const services = trainNames.filter((name) => /\d/.test(name));
  /*
    **この往復でモデルが読んだ本文**と突き合わせる。後から同じクエリを投げ直しても
    検索結果は毎回同じではないので、突き合わせの相手はここで確定させる必要がある。
    空白の入り方が本文と `message` で違うため、比較の前に空白を落とす。
  */
  const corpus = invoked.webSearchHits
    .map((found) => `${found.title}\n${found.text}`)
    .join('\n')
    .replace(/\s+/g, '');
  const isGrounded = (name: string): boolean =>
    corpus.includes(name.replace(/\s+/g, ''));

  return {
    id: input.id,
    mode,
    ok: true,
    message: result.message,
    sources: result.sources,
    trainNames,
    durations: matches(result.message, DURATION_PATTERN),
    groundedServices: services.filter(isGrounded),
    ungroundedServices: services.filter((name) => !isGrounded(name)),
    webSearches: invoked.webSearches,
    totalTokens: invoked.usage.totalTokens,
    elapsedMs,
  };
}

async function run(): Promise<void> {
  const gatewayUrl = process.env.FORMECHO_WEB_SEARCH_GATEWAY_URL;
  if (gatewayUrl === undefined || gatewayUrl === '') {
    throw new Error(
      'FORMECHO_WEB_SEARCH_GATEWAY_URL を立ててください（無効側はこのスクリプトが自分で外します）',
    );
  }

  const observations: Observation[] = [];
  for (const mode of ['disabled', 'enabled'] as const) {
    // 設定だけを切り替える。無効側は「ツールが無い」状態そのものにする
    // （プロンプトで検索を禁じるのではなく）。
    if (mode === 'disabled') delete process.env.FORMECHO_WEB_SEARCH_GATEWAY_URL;
    else process.env.FORMECHO_WEB_SEARCH_GATEWAY_URL = gatewayUrl;

    for (const input of INPUTS) {
      observations.push(await observe(input, mode));
    }
  }

  console.log(JSON.stringify(observations, null, 2));
}

await run();
