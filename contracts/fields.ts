import { z } from 'zod';
import {
  AVAILABILITY_ORDER,
  CANDIDATE_ID_PATTERN,
  DURATION_OPTIONS,
  MEETING_FORMAT_ORDER,
} from './meeting.js';

/**
 * 入力契約と出力契約が共有する欄の定義。
 *
 * WHY: 候補日程の項目（識別子・日付・開始時刻）は、抽出系の入出力
 * （`meeting.parse-candidates` / `meeting.parse-availability`）と推薦系の入出力
 * （`meeting.recommend-schedule`）の両方に現れる。同じ形を2度書くと、片方だけに
 * 制約が足された瞬間に「同じ候補日程」が2つの意味を持つ。
 */

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
export const isoDateSchema = z
  .string()
  .regex(ISO8601_DATE)
  .refine(isCalendarDate, { error: '暦に存在しない日付です' });

/**
 * 24時間表記の時刻（`HH:mm`）。日付と同じく、未解決の文字列を弾くために縛る。
 *
 * `<input type="time">` が受け付ける形と一致させる。「午後」「13時ごろ」のような
 * 表現がそのまま通ると、日付欄と同様に画面が黙って空欄を表示することになる。
 */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeOfDaySchema = z.string().regex(HH_MM);

/**
 * 候補日程の識別子。形と発番は `meeting.ts` が持つ（画面が zod を持ち込めないため）。
 */
export const candidateIdSchema = z
  .string()
  .regex(CANDIDATE_ID_PATTERN)
  .describe('候補日程の識別子。入力で与えられたものをそのまま使う');

/**
 * 会議の候補日程ひとつ。
 *
 * **終了時刻を持たない**（ADR-0005 / `CONTEXT.md`「候補日程」）。終わる時刻は会議の
 * 所要時間から導く。両方持つと、モデルがどちらかを取り違えたときに不整合な組が契約を
 * 通ってしまう — 以前は逆に所要時間を持たず `end_time - start_time` で導いていたが、
 * 所要時間が会議の属性として画面に入った（#66）ので、導出の向きが反転した。
 */
export const candidateFieldsSchema = z.object({
  id: candidateIdSchema,
  date: isoDateSchema.describe('候補日程の日付。YYYY-MM-DD 形式'),
  start_time: timeOfDaySchema.describe('開始時刻。HH:mm 形式（24時間表記）'),
});

/** 会議の所要時間（分）。終わる時刻はこの値と開始時刻から導かれる。 */
export const durationMinutesSchema = z
  .literal(DURATION_OPTIONS)
  .describe(
    `会議の所要時間（分）。候補日程の終了時刻はこの値から導く。${DURATION_OPTIONS.join(' / ')} のいずれか`,
  );

/** 参加形式。会議ごとに1つ決まり、参加者に見せる参加可否の選択肢を決める。 */
export const meetingFormatSchema = z
  .enum(MEETING_FORMAT_ORDER)
  .describe(
    '参加形式。hybrid=ハイブリッド / onsite=現地のみ / online=オンラインのみ',
  );

/** 参加可否ひとつ。未回答はこの値では表さず、参加可否表のセルが無いことで表す。 */
export const availabilitySchema = z
  .enum(AVAILABILITY_ORDER)
  .describe(
    '参加可否。attend_onsite=現地で出席 / attend_remote=リモートで出席 / absent=欠席 / undecided=未定',
  );
