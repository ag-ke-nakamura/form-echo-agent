/**
 * 候補日程を一意に指す文字列。3項目の組をそのまま連結する。
 *
 * WHY: 推薦系は入力の候補日程と出力の順位を突き合わせる必要があり、BFF（入力に無い
 * 候補日程が返っていないか）とフロントエンド（順位をどの行に置くか）が同じ対応を取る。
 * 突き合わせの鍵をそれぞれで組み立てると、片方が日付だけで引いた瞬間に同じ日の別の
 * 時間帯が混ざる。識別子を契約に足さずに済ませるための唯一の共有点なので、ここに置く。
 *
 * **zod を import しない。** フロントエンドはこの関数だけを実行時に必要とするので、
 * スキーマと同じモジュールに置くと SSG のバンドルに zod が丸ごと乗る（`app/lib/api.ts`
 * が型だけを取り込んでいるのと同じ理由）。
 */

/** 出力契約・入力契約に共通の候補日程3項目。実体は `fields.ts` の Zod スキーマ。 */
export interface CandidateFields {
  date: string;
  start_time: string;
  end_time: string;
}

export function candidateKey(fields: CandidateFields): string {
  return `${fields.date} ${fields.start_time}-${fields.end_time}`;
}
