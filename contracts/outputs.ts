import { z } from 'zod';
import type { TaskId } from './task-ids.js';

/**
 * 全 taskId 共通の必須フィールド（参照ドキュメント 6.2節）。
 *
 * message は情報不足時の聞き返しもここに入る。sources は Websearch を使った
 * ときの参照元だが、この検証環境は Websearch を持たないので常に空配列になる。
 */
const commonOutputFields = {
  message: z
    .string()
    .describe(
      'ユーザーへの説明。抽出できなかった項目がある場合は、何が足りないかを尋ねる質問を含める',
    ),
  sources: z
    .array(z.string())
    .describe('参照元 URL のリスト。Web 検索を使っていない場合は空配列'),
};

/**
 * ISO8601 の暦日付（`YYYY-MM-DD`）。時刻とタイムゾーンは持たない。
 *
 * 縛る理由: 素の `z.string()` だと「来月15日」のような未解決の文字列が契約を
 * 通ってしまい、フロントエンドの `<input type="date">` が黙って空欄を表示する
 * （値と「AI が入力」バッジだけが残り、何が起きたか分からない）。ここで縛れば
 * Runtime 側の再試行が働き、それでも駄目なら PARSE_FAILED として表に出る。
 *
 * 時刻を持たない理由: 参照ドキュメント 1.3節の例は `2026-10-15T00:00:00Z` だが、
 * この値の消費側はフォームの日付欄しかなく、時刻もタイムゾーンも捨てている。
 * 精度を上げてもモデルが正しく出すべきものが増えるだけで、`+09:00` を許すと
 * `new Date(iso)` を挟んだ瞬間に日が1日ずれる余地が残る。出張の出発日という
 * 対象自体が日付であって時点ではない。
 */
const ISO8601_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * 暦に実在する日付か。`2026-02-31` のように月日の範囲は満たすが存在しない日を弾く。
 *
 * WHY: 正規表現だけでは月末の日数と閏年を見られない。`ISO8601_DATE` を置いた理由は
 * 「`<input type="date">` が黙って空欄を表示する値を契約で止める」ことだったが、
 * `2026-02-31` はその症状をそのまま再現する。
 *
 * `Date` の ISO パーサは月・日の範囲を検査するので、閏年込みの実在判定になる
 * （`2026-02-29` は Invalid、`2028-02-29` は有効）。`toISOString()` と突き合わせるのは、
 * パーサが受け付ける桁揃えの緩さ（`2026-1-1`）を落とすため。
 *
 * 二段構えにするのは、正規表現だけが JSON Schema に写るため。粗い形の検査はモデルへの
 * 指示として効き、実在判定は `safeParse` の段で効いて Structured Output の再試行に回る。
 */
function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(`${value}T`)
  );
}

/** 日付欄の共通スキーマ。交通ICと会議ロジの両方がこれを使う。 */
const isoDateSchema = z
  .string()
  .regex(ISO8601_DATE)
  .refine(isCalendarDate, { error: '暦に存在しない日付です' });

export const parseReservationOutputSchema = z.object({
  departure_date: isoDateSchema
    .nullable()
    .describe('出発日。YYYY-MM-DD 形式。読み取れない場合は null'),
  return_date: isoDateSchema
    .nullable()
    .describe('帰着日。YYYY-MM-DD 形式。読み取れない場合は null'),
  origin: z.string().nullable().describe('出発地。読み取れない場合は null'),
  destination: z
    .string()
    .nullable()
    .describe('目的地。読み取れない場合は null'),
  transport: z
    .enum(['train', 'flight', 'other'])
    .nullable()
    .describe('交通手段。読み取れない場合は null'),
  ...commonOutputFields,
});

export type ParseReservationOutput = z.infer<
  typeof parseReservationOutputSchema
>;

/**
 * 24時間表記の時刻（`HH:mm`）。日付と同じく、未解決の文字列を弾くために縛る。
 *
 * `<input type="time">` が受け付ける形と一致させる。「午後」「13時ごろ」のような
 * 表現がそのまま通ると、日付欄と同様に画面が黙って空欄を表示することになる。
 */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 会議の候補日程ひとつ。
 *
 * 所要時間（`duration`）を持たない。「3時間」は `end_time - start_time` で導ける。
 * 両方持つと、モデルがどちらかを取り違えたときに不整合な組が契約を通ってしまう。
 */
const candidateFieldsSchema = z.object({
  date: isoDateSchema.describe('候補日程の日付。YYYY-MM-DD 形式'),
  start_time: z
    .string()
    .regex(HH_MM)
    .describe('開始時刻。HH:mm 形式（24時間表記）'),
  end_time: z
    .string()
    .regex(HH_MM)
    .describe('終了時刻。HH:mm 形式（24時間表記）'),
});

/**
 * 終了時刻は開始時刻より後、という欄をまたぐ不変条件。
 *
 * WHY: #23 が所要時間（`duration`）を欄として持たないと決めた理由は
 * 「`end_time - start_time` で導ける」だった。逆順の組を通すとその導出が負になり、
 * `duration` を捨てた代わりに契約が引き受けたはずの不変条件が守られない。画面側でも
 * `<input type="time">` は2つの欄の関係を見ないので、逆順のまま表示されて誰も気付かない。
 *
 * 日をまたぐ会議（`22:00`–`01:00`）は存在しないものとして扱うので、比較は素直な大小で
 * よい。`HH_MM` が桁揃えを保証しているため、辞書順の比較がそのまま時刻の前後になる。
 *
 * この検査は JSON Schema に写らないため、モデルへの指示としては効かず `safeParse` の段で
 * 初めて弾かれて再試行に回る。`.max(10)` とは効き方が違うので、`SKILL.md` にも同じ制約を書く。
 */
const candidateSchema = candidateFieldsSchema.refine(
  ({ start_time, end_time }) => start_time < end_time,
  {
    error: '終了時刻は開始時刻より後である必要があります',
    path: ['end_time'],
  },
);

/** 1回の応答で返せる候補日程の上限。`SKILL.md` の制約と同じ数を置く。 */
export const MAX_CANDIDATES = 10;

export const parseCandidatesOutputSchema = z.object({
  candidates: z
    .array(candidateSchema)
    .max(MAX_CANDIDATES)
    .describe(
      `会議の候補日程。多くとも${MAX_CANDIDATES}件。読み取れない場合は空配列`,
    ),
  ...commonOutputFields,
});

export type ParseCandidatesOutput = z.infer<typeof parseCandidatesOutputSchema>;

/**
 * 候補日程ひとつに対する参加可否。
 *
 * 候補日程IDではなく日付で写す。ユーザーの自然文が言っているのは日付であって
 * 候補日程IDではなく、IDへの解決は AI にとって余計な仕事になる（ADR-003）。この日付を
 * 画面が持っている候補日程の一覧に当てる突き合わせはフロントエンドが行う。
 */
const availabilitySchema = z.object({
  date: isoDateSchema.describe('参加可否を答えた日付。YYYY-MM-DD 形式'),
  /**
   * ○×の2値に留める。`maybe` や時間帯を足すと、手で埋める側（各候補日程に手動で○×）
   * にもそれを入れる UI が要り、非AI経路と形が揃わなくなる。「16日の午後なら大丈夫」
   * のような入力は `message` が説明して吸収する。
   */
  available: z
    .boolean()
    .describe('その日付に参加できるなら true、できないなら false'),
});

/** 1回の応答で返せる参加可否の上限。`SKILL.md` の制約と同じ数を置く。 */
export const MAX_AVAILABILITY_ENTRIES = 10;

export const parseAvailabilityOutputSchema = z.object({
  availability: z
    .array(availabilitySchema)
    .max(MAX_AVAILABILITY_ENTRIES)
    .describe(
      `日付ごとの参加可否。多くとも${MAX_AVAILABILITY_ENTRIES}件。読み取れない場合は空配列`,
    ),
  ...commonOutputFields,
});

export type ParseAvailabilityOutput = z.infer<
  typeof parseAvailabilityOutputSchema
>;

/**
 * taskId から出力契約を引くための表。Runtime は Structured Output のスキーマとして、
 * BFF はフロントエンドへ返す前の検査として、同じものを参照する。
 */
export const OUTPUT_SCHEMAS = {
  'ic-card.parse-reservation': parseReservationOutputSchema,
  'meeting.parse-candidates': parseCandidatesOutputSchema,
  'meeting.parse-availability': parseAvailabilityOutputSchema,
} satisfies Record<TaskId, z.ZodType>;
