// 値として引くので `index.js` ではなくモジュール直指し（理由は `ai-assistant.tsx` の
// 同じ import）。`meeting.ts` は zod を持たないので、バンドルにスキーマが乗らない。
import type { AiEvaluationLabel } from "@contracts/recommendation";
import type { Availability, MeetingFormat } from "@contracts/meeting";
import { DURATION_OPTIONS } from "@contracts/meeting";

/**
 * 会議情報（会議名・所要時間・参加形式）の表示文字列と、そこから導かれる時刻。
 *
 * WHY 画面から切り離すか: 表示文字列はタブ2で入れてタブ3が読むという**タブをまたぐ
 * 取り決め**で、書式は設計書 3節が決めている。JSX の中に埋め込むと画面を描かない
 * 限り確かめられない（`error-guidance.ts` の文言と同じ理由でここにある）。
 *
 * **値域そのものは `contracts/meeting.ts` にある**（#67 / ADR-0005）。参加形式と
 * 所要時間は Runtime へ渡す構造化入力に載るようになったので、3プロジェクトの共有語彙に
 * なった。ここに残るのは画面だけが要るもの — 表示名と、終わる時刻の導出である。
 */
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
 * 参加可否の表示名。**記号（○×）に畳まない。**
 *
 * WHY: 4状態になった以上、2記号では現地とリモート、欠席と未定を区別できず、職員と AI が
 * 見ている表が食い違う（`CONTEXT.md`「参加可否」は○×を _Avoid_ にしている）。未回答は
 * ここに無い — 回答の不在はセルが存在しないことで表され、参加可否の値ではない。
 */
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  attend_onsite: "現地",
  attend_remote: "リモート",
  absent: "欠席",
  undecided: "未定",
};

/**
 * AI評価ラベルの表示名（設計書 4.3節）。`CONTEXT.md`「AI評価ラベル」の語をそのまま使う。
 *
 * **AI はこの語を返さない。** ラベルは評点と回答率から導かれる（ADR-0007）ので、
 * ここにあるのは英語の値域を職員の言葉に写す表だけである。
 */
export const AI_EVALUATION_LABELS: Record<AiEvaluationLabel, string> = {
  recommended: "推奨",
  backup: "予備に提案",
  consider: "要検討",
  rejected: "条件合わず",
  unanswered: "参加入力未済",
};

/**
 * 会議情報。タブ2で職員が入れ、タブ3のヘッダーとタブ4の内訳表示が読む。
 *
 * AI が埋める対象ではないので `{value, source}` の形（AI 由来か手入力かの印）を
 * 持たない。所要時間は AI へ渡す与件の側であり、参加形式は参加可否の選択肢を
 * 決める前提であって抽出の結果ではない。
 */
export type MeetingInfo = {
  name: string;
  durationMinutes: (typeof DURATION_OPTIONS)[number];
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

/**
 * 候補日程を指すのに要る最小限の組。
 *
 * WHY 名前を付けるか: 日付と開始時刻はいつも一緒に運ばれる（表示名の組み立て・
 * 前後の突き合わせ・Runtime へ渡す与件）。組で受ける関数が3つになった時点で、
 * 引数2つを並べ続けると呼び出し側が順番を取り違えられる。
 *
 * 識別子は持たない。**発番済みのもの（`SelectedCandidate`）と、AI が作ったばかりで
 * まだ識別子の無いもの（出力契約の候補日程）の両方**がこの形に収まる必要がある。
 */
export type CandidateTime = {
  date: string;
  start_time: string;
};

const MINUTES_PER_DAY = 24 * 60;

/**
 * 候補日程が終わる時刻。**候補日程は終了時刻を持たない**（ADR-0005）ので、
 * 開始時刻と会議の所要時間から導く。
 *
 * WHY 画面側にあるか: この導出を要るのは画面だけである。Runtime には所要時間を
 * 与件として渡してあり（モデルは開始時刻だけを決める）、BFF は候補日程の中身を
 * 見ない。共有していない計算を `contracts/` に置くと、契約が誰も引かない関数を持つ。
 *
 * 日をまたぐ会議は無いものとして扱う（`SKILL.md` の制約と同じ）ので、24時を越えたら
 * `null` を返す。丸めて `23:59` を返すと、画面には収まっているように見えるのに
 * 所要時間ぶんの時間が取れていない候補日程が出る。
 */
export function candidateEndTime(
  startTime: string,
  durationMinutes: number,
): string | null {
  const [hours, minutes] = startTime.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;

  const end = hours * 60 + minutes + durationMinutes;
  if (end > MINUTES_PER_DAY) return null;

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

/**
 * 候補日程ひとつの表示名。日付と、所要時間から導いた時間帯を並べる。
 *
 * 終わる時刻が出せない場合は開始時刻だけを出す。「〜」の右が空のまま並ぶと、
 * 読み取り漏れなのか日をまたいだのかが画面から区別できない。
 */
export function candidateRangeText(
  startTime: string,
  durationMinutes: number,
): string {
  const end = candidateEndTime(startTime, durationMinutes);
  return end === null ? startTime : `${startTime}–${end}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * その日付の曜日。暦に無い日付と桁揃えの緩い日付（`2026-9-8`）には `null` を返す。
 *
 * WHY 画面側の共有語彙に置くか: 参加可否タブの日付見出し（`M月D日(曜)`）と候補日程
 * タブのカレンダーの列見出し（`M/D(曜)`）が同じ曜日を要る。数え方を2箇所に書くと、
 * 片方だけがずれても**両方の画面が同じ日を違う曜日で呼ぶ**ところまで進まないと
 * 気付けない。
 *
 * `Intl` を使わないのは SSG のため。ビルド環境とブラウザでロケールが違うと、
 * ビルド時に描いた HTML と初回描画が食い違う。
 */
export function weekdayOf(date: string): string | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // 桁揃えの緩さ（`2026-1-1`）を落とす。`isCalendarDate`（契約側）と同じ突き合わせ。
  if (!parsed.toISOString().startsWith(`${date}T`)) return null;

  return WEEKDAYS[parsed.getUTCDay()];
}

/**
 * 日付グループの見出し（設計書 4.6.1節の `M月D日(曜)`）。
 *
 * WHY 曜日を出すか: 参加者が自分の予定と突き合わせる単位は曜日であることが多い
 * （「火曜は毎週埋まっている」）。ISO の日付だけだと、参加者は毎回カレンダーを
 * 開いて数え直すことになる。
 *
 * 曜日の数え方は同じファイルの `weekdayOf`（カレンダーの列見出しも同じものを引く）。
 * 読めない日付はそのまま返す — 見出しが消えると、どの候補日程の話なのかが無くなる。
 */
export function dateHeadingText(date: string): string {
  const weekday = weekdayOf(date);
  if (weekday === null) return date;

  const [, month, day] = date.split("-").map(Number);
  return `${month}月${day}日(${weekday})`;
}

/**
 * 候補日程ひとつの表示名。反映の報告・聞き返しの一覧・プレビューの一覧が引く。
 *
 * 日付まで含めるのは、どれも**日付グループの外**に出る文字列だから。時間帯だけを
 * 挙げると、同じ時刻の候補日程が別の日に2つあるときに区別が付かない。
 *
 * 受けるのは識別子を持たない形（日付と開始時刻だけ）。候補日程タブのプレビューは
 * **まだ発番されていない候補日程**を並べる（識別子を配るのは反映のとき）ので、
 * `SelectedCandidate` を要求すると同じ書式をもう1箇所に書くことになる。
 */
export function candidateLabel(
  candidate: CandidateTime,
  durationMinutes: number,
): string {
  return `${dateHeadingText(candidate.date)} ${candidateRangeText(
    candidate.start_time,
    durationMinutes,
  )}`;
}
