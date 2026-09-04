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

/**
 * 候補日程を一意に指す識別子の形。**フロントエンドが発番し、AI は自分では作らない**
 * （ADR-0005）。
 *
 * WHY 形を縛るか: 構造化入力はサニタイズも Guardrail チェックも通らない（ADR-0004）。
 * 検査を通さない値に自由文字列を許すと、そこが prompt injection の窓になる。参加者の
 * 識別子（`/^参加者[A-Z]$/`）を縛ったのと同じ理由がそのまま候補日程にも要る。
 *
 * WHY この形か: 設計書（`temp/design/schedule-recommend-ai-screen-design.md` 8節）が
 * 例に挙げる `candidate-1` をそのまま採る。本番で候補日程が DB のレコードIDを持つように
 * なったら、緩めるのはここ1箇所で済む — 突き合わせが識別子ベースであること自体は
 * 変わらない。桁数を縛るのは、上限の無い数字列でトークンを食わせられないようにするため。
 *
 * WHY 値域の側に置くか: 発番する側（画面）と検査する側（`fields.ts` の Zod スキーマ）が
 * 同じ形を2度書かないため。画面は zod を持ち込めないので、両者が引ける場所はここしかない。
 */
export const CANDIDATE_ID_PATTERN = /^candidate-\d{1,6}$/;

/** 連番から候補日程の識別子を作る。発番するのは画面だけで、AI は選ぶだけ。 */
export function candidateIdOf(sequence: number): string {
  return `candidate-${sequence}`;
}

/**
 * 1回のリクエストで渡せる候補日程の上限。**AI が1回の応答で作れる件数
 * （`MAX_CANDIDATES`）とは別物。**
 *
 * WHY 分けるか: あちらは AI が作れる件数で、こちらは画面が抱えている件数である。
 * 職員は AI に何度も作らせ、カレンダーで手でも足せる（#69）ので、入力の件数は
 * 1回の応答の上限を素直に超える。同じ数を使うと、11件目を足した職員がタブ3・タブ4で
 * INVALID_INPUT に当たる — 画面には何も悪いところが無いのに AI だけが使えなくなる。
 *
 * WHY 上限そのものは要るか: 構造化入力はサニタイズを通らないので、件数を縛らないと
 * 参照ドキュメント 13.1節の入力想定をいくらでも超えられる。
 *
 * **画面はこの上限を超える前に手を打つ責任を負う**（`nextjs-app/app/lib/candidate-limit.ts`）。
 * 超えたリクエストは BFF の門が INVALID_INPUT で弾くが、職員から見ると自分の書いた
 * 自然文が悪かったように読める。だから値として引ける場所に置いてある。
 */
export const MAX_INPUT_CANDIDATES = 30;
