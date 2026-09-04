/**
 * 会議情報（会議名・所要時間・参加形式）の値域と表示文字列。
 *
 * WHY 画面から切り離すか: この3つはタブ2で入れてタブ3が読むという**タブをまたぐ
 * 取り決め**で、書式は設計書 3節が決めている。JSX の中に埋め込むと画面を描かない
 * 限り確かめられない（`error-guidance.ts` の文言と同じ理由でここにある）。
 */

/**
 * 参加形式の値域と、ラジオに並べる順。**配列を正典にして型をここから導く。**
 *
 * WHY: 値を足したときに `MEETING_FORMAT_LABELS`（`Record<MeetingFormat, string>`）が
 * 型検査で表示名の追加を要求し、ラジオの列も自動で増える。列挙を2箇所に書くと、
 * 選択肢に出るのに表示名の無い参加形式が作れてしまう。
 */
export const MEETING_FORMAT_ORDER = ["hybrid", "onsite", "online"] as const;

/**
 * 参加形式。会議ごとに1つ決まり、参加者に見せる参加可否の選択肢を決める
 * （`CONTEXT.md`「参加形式」）。
 *
 * 設計書（`temp/design/guest-response-ai-screen-design.md` 3.2節）は「未定」も
 * 挙げているが値域に置かない。未定のときに参加可否の選択肢を4つ出すのか3つに
 * 畳むのかが一意に決まらず、設計書自身がその出し分けを「暫定」と書いている。
 *
 * WHY 契約（`contracts/`）ではなくここか: 参加形式が3プロジェクトの共有語彙に
 * なるのは Runtime へ画面の状態を渡すとき（#67 / ADR-0005）で、今はどのタスクの
 * `input` にも載らない。先に契約へ置くと誰も引かない値域が生えるので、画面が
 * 使い始めるこの段では画面側に置き、#67 が `inputs.ts` へ移す。
 */
export type MeetingFormat = (typeof MEETING_FORMAT_ORDER)[number];

/**
 * 参加形式の表示名。`CONTEXT.md` の用語集の語をそのまま使う。
 *
 * 設計書 3.2節は `オンライン` と書いているが、用語集は「オンラインのみ」を正と
 * している。「現地のみ」と対になる語であり、タブ2の選択肢とタブ3のヘッダーで
 * 同じ会議が違う名前で呼ばれないことのほうが大事なので、用語集を採る。
 */
export const MEETING_FORMAT_LABELS: Record<MeetingFormat, string> = {
  hybrid: "ハイブリッド",
  onsite: "現地のみ",
  online: "オンラインのみ",
};

/**
 * 所要時間の選択肢（分）。自由入力にせず30分刻みに縛る。
 *
 * WHY: 用語集（`CONTEXT.md`「スロット」）が候補日程の表示単位を30分の升目と
 * 決めており、職員の1クリックは所要時間ぶんの連続したスロットになる。刻みから
 * 外れた値（45分など）を入れられるようにすると、1クリックが半端なスロットに
 * 掛かる場合の描画を決めなければならなくなる。
 *
 * 設計書 5節の「所要時間未設定時はデフォルト30分枠」に当たる状態は持たない。
 * 未設定を選べない代わりに既定が30分なので、職員が何もしなければ設計書と同じ
 * 30分枠になる。
 */
export const DURATION_OPTIONS = [30, 60, 90, 120] as const;

/**
 * 会議情報。タブ2で職員が入れ、タブ3のヘッダーとタブ4の内訳表示が読む。
 *
 * AI が埋める対象ではないので `{value, source}` の形（AI 由来か手入力かの印）を
 * 持たない。所要時間は AI へ渡す与件の側であり、参加形式は参加可否の選択肢を
 * 決める前提であって抽出の結果ではない。
 */
export type MeetingInfo = {
  name: string;
  durationMinutes: number;
  format: MeetingFormat;
};

/**
 * 既定値。所要時間は設計書 5節の「所要時間未設定時はデフォルト30分枠」に、
 * 参加形式は #66 が決めた `hybrid` に合わせる。
 *
 * 固定値なのは SSG のため（`candidates-panel.tsx` の `INITIAL_ROWS` と同じ理由）。
 */
export const INITIAL_MEETING_INFO: MeetingInfo = {
  name: "",
  durationMinutes: 30,
  format: "hybrid",
};

/** 会議名が空のときにタブ3の見出しへ出す文字列。 */
const UNNAMED_MEETING = "（会議名未入力）";

/**
 * タブ3の見出しに出す会議名（設計書 3.1節）。
 *
 * 会議名が空でも見出しを消さない。空白にすると「この画面には会議情報が無い」と
 * 読めてしまい、タブ2で入れれば埋まることが画面から分からなくなる。空白だけの
 * 名前を素通しにすると同じ見た目になるので、`trim` で同じ扱いに寄せる。
 */
export function meetingHeadingText(info: MeetingInfo): string {
  return info.name.trim() === "" ? UNNAMED_MEETING : info.name;
}

/**
 * タブ3のヘッダーのサブ情報（設計書 3.2節）。区切りも語も設計書のまま。
 *
 * 用語集（`CONTEXT.md`）が正としているのは**所要時間**で、タブ2の入力欄もそう
 * 呼んでいる。ここだけ「開催時間」になるのは設計書 3.2節の書式をそのまま採るため
 * （#66 の受け入れ条件が「設計書の書式で出る」）。`オンラインのみ` では逆に用語集を
 * 採ったので、判断が割れている理由を書いておく — **あちらは同じ画面のタブ2と
 * タブ3で同じ会議が違う名前で呼ばれる**のに対し、こちらは職員が見る語（所要時間）と
 * 参加者が見る語（開催時間）で読み手が違い、1人の目に両方は入らない。
 */
export function meetingSubInfoText(info: MeetingInfo): string {
  return `開催時間: ${info.durationMinutes}分 | 参加形式: ${MEETING_FORMAT_LABELS[info.format]}`;
}
