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
const ISO8601_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const parseReservationOutputSchema = z.object({
  departure_date: z
    .string()
    .regex(ISO8601_DATE)
    .nullable()
    .describe('出発日。YYYY-MM-DD 形式。読み取れない場合は null'),
  return_date: z
    .string()
    .regex(ISO8601_DATE)
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
const candidateSchema = z.object({
  date: z
    .string()
    .regex(ISO8601_DATE)
    .describe('候補日程の日付。YYYY-MM-DD 形式'),
  start_time: z
    .string()
    .regex(HH_MM)
    .describe('開始時刻。HH:mm 形式（24時間表記）'),
  end_time: z
    .string()
    .regex(HH_MM)
    .describe('終了時刻。HH:mm 形式（24時間表記）'),
});

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
 * taskId から出力契約を引くための表。Runtime は Structured Output のスキーマとして、
 * BFF はフロントエンドへ返す前の検査として、同じものを参照する。
 */
export const OUTPUT_SCHEMAS = {
  'ic-card.parse-reservation': parseReservationOutputSchema,
  'meeting.parse-candidates': parseCandidatesOutputSchema,
} satisfies Record<TaskId, z.ZodType>;
