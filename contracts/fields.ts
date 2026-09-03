import { z } from 'zod';

/**
 * 入力契約と出力契約が共有する欄の定義。
 *
 * WHY: 候補日程の3項目（日付・開始時刻・終了時刻）は、抽出系の出力（`meeting.parse-candidates`）
 * と推薦系の入出力（`meeting.recommend-schedule`）の両方に現れる。同じ形を2度書くと、
 * 片方だけに制約が足された瞬間に「同じ候補日程」が2つの意味を持つ。
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

/**
 * 会議の候補日程ひとつ。
 *
 * 所要時間（`duration`）を持たない。「3時間」は `end_time - start_time` で導ける。
 * 両方持つと、モデルがどちらかを取り違えたときに不整合な組が契約を通ってしまう。
 */
export const candidateFieldsSchema = z.object({
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
export function endsAfterStart(fields: {
  start_time: string;
  end_time: string;
}): boolean {
  return fields.start_time < fields.end_time;
}

export const END_AFTER_START_ERROR = {
  error: '終了時刻は開始時刻より後である必要があります',
  path: ['end_time'],
};
