/**
 * 会議ロジの共有語彙。**値域そのもの**を置き、Zod スキーマは `fields.ts` がここから導く。
 *
 * WHY このファイルが分かれているか: **zod を import しない。** フロントエンドは
 * 参加形式のラジオを描き、参加可否のセルを描き、所要時間の選択肢を並べるために
 * これらを**値として**実行時に必要とする。スキーマと同じモジュールに置くと SSG の
 * バンドルに zod が丸ごと乗る（`prompt-requirement.ts` が型だけを取り込んでいるのと
 * 同じ理由）。`candidate-key.ts` が担っていた枠を、突き合わせの鍵ではなく値域が継いだ。
 *
 * 各列挙は**配列を正典にして型を導く**。値を足したときに、表示名の表
 * （`Record<MeetingFormat, string>` など）が型検査で追加を要求する。列挙を2箇所に
 * 書くと、選択肢に出るのに表示名の無い値が作れてしまう。
 */

/**
 * 参加形式の値域と、ラジオに並べる順（`CONTEXT.md`「参加形式」）。
 *
 * 設計書（`temp/design/guest-response-ai-screen-design.md` 3.2節）は「未定」も挙げて
 * いるが値域に置かない。未定のときに参加可否の選択肢を4つ出すのか3つに畳むのかが
 * 一意に決まらず、設計書自身がその出し分けを「暫定」と書いている（#66）。
 */
export const MEETING_FORMAT_ORDER = ['hybrid', 'onsite', 'online'] as const;

export type MeetingFormat = (typeof MEETING_FORMAT_ORDER)[number];

/**
 * 参加可否の値域と、ラジオに並べる順（`CONTEXT.md`「参加可否」）。
 *
 * 設計書 6.4節が挙げる `attend`（形式不明の出席）は値域に置かない。画面がどのラジオを
 * 選ぶかがフロント側の分岐（参加形式ごとの既定値）に依存し、「ユーザーが直したら
 * バッジを消す」判定が誤爆する — 職員が触っていないのに選択が変わったように見える。
 * 参加形式が現地のみ／オンラインのみの会議では、画面が選択肢を3つに畳んだうえで
 * `attend_onsite` / `attend_remote` のどちらかへ正規化する（#70）。
 *
 * **未定は「未回答」ではない。** 未定は参加者が答えた結果であり、未回答は回答の不在で、
 * 後者は参加可否表のセルが存在しないことで表す。
 */
export const AVAILABILITY_ORDER = [
  'attend_onsite',
  'attend_remote',
  'absent',
  'undecided',
] as const;

export type Availability = (typeof AVAILABILITY_ORDER)[number];

/**
 * その参加可否が「参加できる」に数えられるか。
 *
 * WHY ここに置くか: 参加可能人数を数えるのは画面（○の数の列）と `contracts/` の集計
 * （#71）の両方で、数え方を2箇所に書くと片方が未定を出席に畳んだ瞬間に、職員が見る
 * 表と AI が読む与件が食い違う。4状態のうち出席は2つあるという事実がここ1箇所にある。
 */
export function isAttending(availability: Availability): boolean {
  return availability === 'attend_onsite' || availability === 'attend_remote';
}

/**
 * 所要時間（分）の選択肢。自由入力にせず30分刻みに縛る。
 *
 * WHY: 用語集（`CONTEXT.md`「スロット」）が候補日程の表示単位を30分の升目と決めており、
 * 職員の1クリックは所要時間ぶんの連続したスロットになる（#69）。刻みから外れた値
 * （45分など）を許すと、1クリックが半端なスロットに掛かる場合の描画を決めなければ
 * ならなくなる。
 *
 * 候補日程が終了時刻を持たなくなった（ADR-0005）ので、この値は画面の選択肢である
 * だけでなく**終わる時刻を決める唯一の与件**になった。だから Runtime へ渡す
 * 構造化入力にも載る。
 */
export const DURATION_OPTIONS = [30, 60, 90, 120] as const;

export type DurationMinutes = (typeof DURATION_OPTIONS)[number];
