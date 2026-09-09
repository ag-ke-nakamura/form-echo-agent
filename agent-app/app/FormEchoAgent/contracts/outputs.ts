import { z } from 'zod';
import {
  availabilitySchema,
  candidateIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  roundTripSchema,
  timeOfDaySchema,
} from './fields.js';
import { MAX_INPUT_CANDIDATES } from './meeting.js';
import type { TaskId } from './task-ids.js';

/**
 * 全 taskId 共通の必須フィールド（参照ドキュメント 6.2節）。
 *
 * message は情報不足時の聞き返しもここに入る。sources は Websearch を使ったときの
 * 参照元。**Websearch を持つのは交通ICだけ**（#46、`docs/reference-doc-fixes.md` F-22）
 * なので、会議ロジの3タスクでは常に空配列になる。交通ICでも、経路を尋ねられずに
 * 6項目を読み取っただけの往復では空配列が正しい姿である — `sources` が埋まることは
 * 成果ではなく、精度を担保した結果として付いてくる透明性の仕組みである。
 */
const commonOutputFields = {
  message: z
    .string()
    .describe(
      'ユーザーへの説明。抽出できなかった項目がある場合は、何が足りないかを尋ねる質問を含める',
    ),
  sources: z
    .array(z.string())
    .describe(
      '回答の根拠にした参照元 URL のリスト。Web 検索を使っていない場合は空配列',
    ),
};

/**
 * ICカードの利用目的（#68）。**自由文字列にしない。**
 *
 * WHY 選択肢か: 自由文字列だと「打合せ」「打ち合わせ」「ミーティング」が同じ目的の
 * 別表記として並び、画面の `<select>` がどれにも一致しない（結果として未選択に
 * 見える）。設計書 5.4節は `transport`（交通手段）を目的に流用しようとして
 * 「直接マッピングできない」と自分で書いているので、独立した欄として AI に読ませる。
 *
 * WHY 打ち合わせが `discussion` か: `meeting` は会議ロジのドメイン接頭辞
 * （`meeting.parse-candidates` 等）と同じ語で、grep したときに交通ICの利用目的が
 * 会議ロジの一部に見える。
 *
 * `MEETING_FORMAT_ORDER` 等と違って `..._ORDER` と呼ばないのは、並び順を使う消費者が
 * いないため。`<select>` の並びは画面側の表示名の表が決める。
 */
const PURPOSE_VALUES = [
  'discussion',
  'training',
  'inspection',
  'business_trip',
  'other',
] as const;

/** 1回の応答で返せる経路候補の上限（#100）。Skill の制約と同じ数を置く。 */
export const MAX_ROUTE_CANDIDATES = 5;

/**
 * 同行者の人数の上限（#176）。Skill の制約と同じ数を置く。
 *
 * WHY 上限が要るか: 画面はこの人数ぶんの**空の行を作る**（`reservation-form.ts`）。
 * 縛らないと、読み違えた1つの数字がそのまま行数になる。
 *
 * **超えたときにモデルへ求めるのは切り詰めではなく null**（＝人数は分からない）。
 * 経路候補や候補日程は「多くとも N 件返す」で意味が保たれるが、人数を N で頭打ちに
 * すると間違った人数を自信を持って返すことになり、**行のラベルが連番なので画面からは
 * 気付けない。**
 *
 * 契約違反として弾く（＝作り直させ、直らなければ `PARSE_FAILED`）ことは経路候補の
 * 上限と同じ扱いである。1つの欄のために応答全体を捨てることになるが、Skill が
 * 「10人を超える場合も null」という**適合する道**を与えているので、モデルには従える
 * 選択肢がある。間違った行数が黙って通るほうが害が大きい。
 */
export const MAX_COMPANIONS = 10;

/**
 * 移動経路の候補ひとつ（#100、`CONTEXT.md`「移動経路」）。
 *
 * WHY 単一の `route`/`transport_cost` から配列へ変えたか: 最安の経路を選ぶには
 * 比較対象が要る。単一のフィールドのままでは、AI が内部で比較したかどうかを
 * 契約からは確かめられない。
 *
 * `is_selected` はちょうど1件（経路候補が0件のときは0件）という不変条件を
 * `parseReservationOutputSchema` の `.refine()` が見る。単体のフィールドでは
 * 表せない条件なので、ここでは真偽値のまま持つ。
 */
const routeCandidateSchema = z.object({
  route: z
    .string()
    .describe(
      '最寄から最寄までの移動経路。区間ごとに利用交通機関を添えた1本の文字列（例:「新宿駅(東京メトロ丸ノ内線) => 霞ケ関駅(東京メトロ日比谷線) => 虎ノ門駅」）。端に建物名・施設名・地名を置かず、駅名またはバス停名で始めて終える',
    ),
  /** IC運賃前提の運賃（#100）。グリーン車・特急料金は含まない。 */
  fare: z
    .string()
    .describe(
      'IC運賃（例:「1980円」）。与件の往復区分が round なら往復分（片道の2倍）',
    ),
  duration: z.string().describe('所要時間（例:「2時間30分」）'),
  transfer_count: z.number().int().min(0).describe('乗換回数。乗り換えなしは0'),
  is_selected: z
    .boolean()
    .describe('比較検討した結果、この経路候補を採用したかどうか'),
  reason: z
    .string()
    .describe(
      '採用した理由、または他の候補と比べて採用しなかった理由（例:「運賃が最安」「所要時間が最短の1.5倍を超える」）',
    ),
  /**
   * 定期重複区間（#101、CONTEXT.md「定期重複区間」）。
   *
   * 定期区間は自由文でしか渡らない（構造化入力に載るのは運賃の額を決める与件だけ）。
   * **自由文に定期区間の言及が無ければ全候補で null のまま。** 言及があるのに重複が
   * 無い候補は空配列にする — null は「定期区間そのものが不明」、空配列は
   * 「定期区間は分かったがこの候補とは重ならない」を表し、この2つを同じ値で潰すと
   * 定期区間を聞き返すべきかどうかが `route_candidates` から読めなくなる。
   */
  commuter_pass_overlap_sections: z
    .array(z.string())
    .nullable()
    .describe(
      '定期区間とこの経路候補が重複する駅間。連続区間ごとに「駅名 => 駅名」の形式で1件（例:「新宿 => 渋谷」）。自由文に定期区間の言及が無い場合は null',
    ),
});

export const parseReservationOutputSchema = z
  .object({
    /*
      借りる日はカードを受け取る**日**であって時点ではない（#86。#68 が付けた
      時刻を撤回した）。返す日時は引き続き時点なので `isoDateTimeSchema` のまま。
    */
    borrow_at: isoDateSchema
      .nullable()
      .describe('ICカードを借りる日。YYYY-MM-DD 形式。読み取れない場合は null'),
    return_at: isoDateTimeSchema
      .nullable()
      .describe(
        'ICカードを返す日時。YYYY-MM-DDTHH:mm 形式。読み取れない場合は null',
      ),
    /**
     * 出発地・目的地（#170）。**与件にも載る**（`parseReservationInputSchema`）ので、
     * 往復区分と同じ規則が掛かる — 与件が既定値のまま（または前回 AI が入れた値）なら
     * 追加指示の場所で AI が書き換え、職員が手で入れた値と食い違うなら書き換えずに
     * 聞き返す（ADR-0018。規則は Skill が持つ）。
     *
     * **与件が空でも `null` を返せる。** 職員がどちらの欄も埋めず追加指示も書かずに
     * 押した回は、読み取る材料が無いのが正しい姿である。
     */
    origin: z.string().nullable().describe('出発地。読み取れない場合は null'),
    destination: z
      .string()
      .nullable()
      .describe('目的地。読み取れない場合は null'),
    /**
     * 最寄（#172、CONTEXT.md「最寄」）。出発地・目的地それぞれを、運賃計算の起点・
     * 終点として解決した駅またはバス停。
     *
     * **入力が既に駅名でも返す。** 出る回と出ない回があると、職員は必要な回に
     * 出ているかを確かめられない — 運賃がどの区間の額なのかは常に画面から
     * 読めている必要がある。
     *
     * **特定できなければ null。このとき経路候補は空になる**（下の `.refine()` が
     * 見る）。起点・終点が決まらないまま引いた経路は、どこからどこまでの額なのかを
     * 言えない。**出発地・目的地そのものが null の回も同じ**で、片方だけが欠けた
     * 検索条件（`出発地：不明（最寄：虎ノ門駅）`）を画面に出さないために、4つを
     * まとめて縛る。
     */
    origin_nearest: z
      .string()
      .nullable()
      .describe(
        '出発地の最寄（運賃計算の起点として解決した駅またはバス停）。入力が既に駅名の場合もその駅名を返す。特定できない場合は null',
      ),
    destination_nearest: z
      .string()
      .nullable()
      .describe(
        '目的地の最寄（運賃計算の終点として解決した駅またはバス停）。入力が既に駅名の場合もその駅名を返す。特定できない場合は null',
      ),
    /**
     * 往復区分（#168）。**与件にも載る**（`parseReservationInputSchema`）。
     *
     * 出力にも置くのは、追加指示で「片道で」と言われたときに AI が直せる必要が
     * あるため。直せない値を与件だけで持つと、職員は画面へ戻って選び直すことになる。
     * 与件が既定値のままなら AI が勝ち、職員が手で選んでいたら AI は直さず聞き返す
     * （ADR-0018。規則は Skill が持つ）。
     */
    round_trip: roundTripSchema
      .nullable()
      .describe(
        '往復区分。one_way=片道 / round=往復。与件の値をそのまま返すか、追加指示で明示されていればその値。判断できない場合は null',
      ),
    purpose: z
      .enum(PURPOSE_VALUES)
      .nullable()
      .describe(
        '利用目的。discussion=打ち合わせ / training=研修 / inspection=視察 / business_trip=出張 / other=その他。読み取れない場合は null',
      ),
    /**
     * 同行者の人数（#176）。**職員自身を含まない。**
     *
     * WHY 氏名を載せないか: 参加者名をブラウザに留めると決めた ADR-0008 と同じ種類の
     * データなので、Runtime へ渡さない。画面は人数ぶんの空の行を作り、職員が名前を埋める。
     *
     * WHY null を残すか: 同行者がいない出張のほうが普通なので、**言及が無いことを0人と
     * 断定しない。** 0 は「一人で行く」と書かれた回であり、null は読み取れなかった回で
     * ある。画面は null のとき行を作らず、プレビューにも同行者の行を出さない（普通の
     * 出張で毎回聞き返しになると、聞き返しが意味を失う）。
     */
    companion_count: z
      .number()
      .int()
      .min(0)
      .max(MAX_COMPANIONS)
      .nullable()
      .describe(
        `同行者の人数。職員自身を含まない（「田中さんと2人で」は1、「同行者2人」は2）。読み取れない場合は null。${MAX_COMPANIONS}人を超える場合も null`,
      ),
    route_candidates: z
      .array(routeCandidateSchema)
      .max(MAX_ROUTE_CANDIDATES)
      .describe(
        `出発地から目的地までの経路候補。比較検討した上での最安経路を \`is_selected\` で示す。多くとも${MAX_ROUTE_CANDIDATES}件。Web検索で裏取りできない場合は空配列`,
      ),
    ...commonOutputFields,
  })
  .refine(
    (output) => {
      const selected = output.route_candidates.filter(
        (candidate) => candidate.is_selected,
      ).length;
      return selected === (output.route_candidates.length === 0 ? 0 : 1);
    },
    {
      error:
        '採用フラグ（is_selected）は、経路候補があるときはちょうど1件、無いときは0件にする必要があります',
      path: ['route_candidates'],
    },
  )
  .refine(
    (output) =>
      output.route_candidates.length === 0 ||
      [
        output.origin,
        output.destination,
        output.origin_nearest,
        output.destination_nearest,
      ].every((place) => place !== null),
    {
      error:
        '出発地・目的地とその最寄が揃っていないときは、経路候補を空にする必要があります',
      path: ['route_candidates'],
    },
  );

export type ParseReservationOutput = z.infer<
  typeof parseReservationOutputSchema
>;

export type RouteCandidate = z.infer<typeof routeCandidateSchema>;

/**
 * 新しく作られた候補日程ひとつ。**識別子を持たない。**
 *
 * WHY: 識別子はフロントエンドが発番し、AI は自分では作らない（ADR-0005）。このタスクは
 * まだ存在しない候補日程を作るので、AI には選ぶべき既存の識別子が無い。発番させると、
 * 画面が既に配った識別子と衝突する組を作れてしまう。
 *
 * 終了時刻も持たない。終わる時刻は会議の所要時間から導く（`CONTEXT.md`「候補日程」）。
 * 所要時間は構造化入力として渡してあるので、AI は開始時刻だけを決めればよい。
 */
const newCandidateSchema = z.object({
  date: isoDateSchema.describe('候補日程の日付。YYYY-MM-DD 形式'),
  start_time: timeOfDaySchema.describe('開始時刻。HH:mm 形式（24時間表記）'),
});

/** 1回の応答で返せる候補日程の上限。Skill の制約と同じ数を置く。 */
export const MAX_CANDIDATES = 10;

export const parseCandidatesOutputSchema = z.object({
  candidates: z
    .array(newCandidateSchema)
    .max(MAX_CANDIDATES)
    .describe(
      `会議の候補日程。多くとも${MAX_CANDIDATES}件。読み取れない場合は空配列`,
    ),
  ...commonOutputFields,
});

export type ParseCandidatesOutput = z.infer<typeof parseCandidatesOutputSchema>;

/**
 * 候補日程ひとつに対する参加可否。**候補日程は識別子で指す**（ADR-0005）。
 *
 * 日付で写していたのは、契約に識別子が無かったからである。クリック単位が候補日程に
 * なった結果（#69）**同じ日に複数の候補日程が普通に発生する**ので、日付で指すと
 * 「10月15日の14時には出られるが16時は無理」を表せない。
 *
 * **判定できなかった候補日程は要素を持たない。`null` を返させない。** 参加可否の
 * 値域に「判定できず」を足すのと同じことになり、参加者が答えた未定と AI が読み取れ
 * なかったことが同じ列挙に並ぶ（`CONTEXT.md`「未定」）。要素の不在で表せば、画面は
 * 「（判定できませんでした）」として聞き返しの対象にできる。
 */
const candidateAvailabilitySchema = z.object({
  candidate_id: candidateIdSchema.describe(
    '参加可否を答えた候補日程の識別子。入力の candidates にあるものだけを使う',
  ),
  availability: availabilitySchema,
  /**
   * 備考（`CONTEXT.md`「備考」）。4つの選択肢に収まらない事情をここへ移す。
   *
   * WHY 参加可否と別の欄にするか: 「午前中は別の予定があります」を参加可否の値で
   * 表そうとすると、値域が事情の数だけ増える。欄を分ければ、参加可否は4状態のまま
   * 保たれ、画面は備考欄へそのまま写せる。
   *
   * WHY `note` か（設計書 6.4節の `comment` ではなく）: 用語集が「コメント」を
   * _Avoid_ にしている。契約の欄名も3プロジェクトが共有する語彙なので、日本語に
   * 戻したときに用語集と食い違う語を選ばない。
   */
  note: z
    .string()
    .nullable()
    .describe(
      '参加可否に収まらない事情（例:「午前中は別の予定があります」）。無ければ null',
    ),
});

/**
 * 1回の応答で返せる参加可否の上限。**入力の候補日程の上限と同じ数にする。**
 *
 * WHY 候補日程の生成（`MAX_CANDIDATES`）と揃えないか: あちらは AI が新しく作る件数で、
 * 「候補日程は数件であって全営業日ではない」という判断から来ている。こちらは**渡された
 * 候補日程に答える**件数なので、渡しうる件数を下回ってはいけない — 下回ると、上限を
 * 超えた分の候補日程に参加者が答えられないのに、契約もモデルもそれを失敗として
 * 扱わない（Skill が先頭から切り詰めるよう指示するだけ）。**画面には可否の
 * 付かない候補日程が黙って残る。**
 *
 * 識別子で答えるようになった（#70）ので、この上限は `findAvailabilityMismatch` の
 * 部分集合の検査に含まれるようになった（入力の候補日程も同じ数で頭打ちになり、
 * 重複も弾かれるため）。それでも残すのは、**この数だけが JSON Schema に写る**ため
 * — 入力を見る検査は `safeParse` の段でしか効かず、モデルへの指示にはならない。
 */
export const MAX_AVAILABILITY_ENTRIES = MAX_INPUT_CANDIDATES;

export const parseAvailabilityOutputSchema = z.object({
  availability: z
    .array(candidateAvailabilitySchema)
    .max(MAX_AVAILABILITY_ENTRIES)
    .describe(
      `候補日程ごとの参加可否。多くとも${MAX_AVAILABILITY_ENTRIES}件。判定できなかった候補日程は含めない`,
    ),
  ...commonOutputFields,
});

export type ParseAvailabilityOutput = z.infer<
  typeof parseAvailabilityOutputSchema
>;

/**
 * 候補日程ひとつに対する**評点と根拠**（ADR-0007）。
 *
 * **候補日程は識別子で指す**（ADR-0005）。日付と開始時刻を写させると、同じものを
 * 2通りで指すことになり、片方だけ書き間違えた組が契約を通ってしまう。
 *
 * WHY 順位ではなく評点か: 設計書 7.2節は同じ判断を評点・ラベル・専用フィールド
 * （`recommended_candidate_id` / `backup_candidate_ids`）の3箇所に置いている。3通りの
 * 言い方で同じことを返させると矛盾した組が出て、ラベルの境界値のたびに再試行が走る。
 * AI に返させるのは評点と根拠だけにし、AI評価ラベルと初期選択は `recommendation.ts` が
 * 導く。**順位が 1..N の順列であること**という欄をまたぐ不変条件も、これで不要になった。
 */
const candidateEvaluationSchema = z.object({
  candidate_id: candidateIdSchema.describe(
    '評点を付けた候補日程の識別子。入力の candidates にあるものだけを使う',
  ),
  /**
   * この候補日程の適切さ。0.0〜1.0。
   *
   * 範囲を縛るのは、閾値（`recommendation.ts` の `SCORE_THRESHOLDS`）が範囲の中の
   * 位置として書かれているため。`1.5` や `-1` が通ると、ラベルの導出が破綻するのでは
   * なく**黙って「推奨」に倒れる** — 職員には AI が強く推したように見える。
   */
  score: z
    .number()
    .min(0)
    .max(1)
    .describe('この候補日程の適切さ。0.0（不適）〜1.0（最適）'),
  /**
   * 評点の根拠（`CONTEXT.md`「候補日提案」）。
   *
   * WHY `comment` か: 用語集は「コメント」を _Avoid_ にしているが、それは**備考**
   * （参加者が書く自由記述）と紛れるためで、こちらは AI が書く根拠である。設計書
   * 7.1節の欄名をそのまま採り、日本語では「根拠」と呼ぶ。
   */
  comment: z
    .string()
    .describe(
      'この評点になった根拠。参加できない参加者や未回答の参加者に触れる。全体の中の順位には触れない',
    ),
});

export const recommendScheduleOutputSchema = z.object({
  evaluations: z
    .array(candidateEvaluationSchema)
    .min(1)
    .describe('全候補日程の評点と根拠。入力の候補日程と同数'),
  ...commonOutputFields,
});

export type RecommendScheduleOutput = z.infer<
  typeof recommendScheduleOutputSchema
>;

/**
 * taskId から出力契約を引くための表。Runtime は Structured Output のスキーマとして、
 * BFF はフロントエンドへ返す前の検査として、同じものを参照する。
 */
export const OUTPUT_SCHEMAS = {
  'ic-card.parse-reservation': parseReservationOutputSchema,
  'meeting.parse-candidates': parseCandidatesOutputSchema,
  'meeting.parse-availability': parseAvailabilityOutputSchema,
  'meeting.recommend-schedule': recommendScheduleOutputSchema,
} satisfies Record<TaskId, z.ZodType>;
