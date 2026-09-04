/*
  「AI 由来か手入力か」の印だけコンポーネント側から引く。**`import type` なので実行時には
  消える**（`availability-form.ts` の同じ import と同じ理由）。
*/
import type { ApplyReport, FieldSource } from "../field-source";
import type {
  CandidateAssessment,
  CandidateEvaluation,
  RecommendScheduleInput,
  ScheduleSelection,
  TableCandidate,
} from "@contracts/index.js";
import { initialSelection } from "@contracts/recommendation";
import { candidateRangeText, type MeetingInfo } from "./meeting-info";

/**
 * 候補日提案タブの組み立て（#71）。
 *
 * WHY 画面から切り離すか: ここにあるのは**AI の提案を職員の選択にどう写すか**という
 * 取り決めである（守る単位は「開催する候補日程の選択」。`CLAUDE.md` の表）。JSX の中に
 * 埋め込むと、手で選んでから提案させる往復を人が繰り返さない限り確かめられない
 * （`availability-form.ts` の `applyAvailabilityResult` と同じ理由）。
 *
 * 評点からラベル・初期選択を導くのは契約側（`contracts/recommendation.ts`）で、ここが
 * 持つのは画面の都合だけ — 表示文字列と、遅れて届いた応答の捨て方である。
 */

/**
 * 会議をどの日程で開くかの決定。**この画面で職員が触れるのはここだけ**で、
 * 参加可否表は読み取り専用の与件である。
 *
 * 候補日程は識別子で指す（ADR-0005）。評点そのものは持たない — 評点は AI の説明の
 * ための道具で、職員が手で作りたいものではない。非AI経路は「候補日程を1つ選ぶ」に
 * 留め、AI が「推奨」と付けたものと職員が選んだものが**同じ場所の同じ印**になる
 * ようにする。どちらの判断で決まったかは `source` が持つ。
 */
export type Decision = { candidateId: string; source: FieldSource };

/**
 * 表と、それに対して作られたもの（提案・決定）を組で持つ。
 *
 * WHY: サンプルの切り替えは提案を消すことが強制である（表が変われば根拠が事実と
 * 食い違う）。応答を待っている間に切り替えられる経路があるので、消すだけでは足りない
 * — 古い表に対する応答が後から届いて新しい表の隣に並ぶ。シードを添えて描画時に
 * 照合すれば、遅れて届いた結果はどこにも出ない。
 */
export type ForTable<T> = { seed: number; value: T };

export function currentValue<T>(
  held: ForTable<T> | null,
  seed: number,
): T | null {
  return held !== null && held.seed === seed ? held.value : null;
}

/**
 * 候補日程の表示名。終わる時刻は会議の所要時間から導く（ADR-0005）。
 *
 * 識別子（`candidate-1`）はそのまま見せない。職員が読みたいのは日時であって、
 * 識別子は突き合わせのための内部の値である。
 */
export function candidateLabel(
  candidate: TableCandidate,
  meetingInfo: MeetingInfo,
): string {
  return `${candidate.date} ${candidateRangeText(candidate.start_time, meetingInfo.durationMinutes)}`;
}

/**
 * 識別子から表示名を引く。引けなければ識別子をそのまま返す。
 *
 * BFF が「入力に無い識別子」を弾いている（`findRecommendationMismatch`）ので引けない
 * 提案はここまで来ないが、型の上では起こりうる。識別子のまま出せば、画面から文字が
 * 消えるより追える。
 */
export function candidateLabelOf(
  candidates: readonly TableCandidate[],
  candidateId: string,
  meetingInfo: MeetingInfo,
): string {
  const candidate = candidates.find((item) => item.id === candidateId);
  return candidate ? candidateLabel(candidate, meetingInfo) : candidateId;
}

/**
 * 参加可能人数と現地・リモートの内訳（設計書 4.5.1節、ストーリー61）。
 *
 * 人数だけでは判断できない — ハイブリッド会議で「8名参加可能」でも、現地が1名なら
 * 会議室を押さえる意味が薄い。**数えるのは契約側の集計**で、AI の出力は使わない。
 */
export function attendanceText(
  metrics: CandidateAssessment["metrics"],
): string {
  return `${metrics.attendCount}名（現地${metrics.attendOnsiteCount}名/リモート${metrics.attendRemoteCount}名）`;
}

/**
 * 根拠を並べる順（評点の高い順）。
 *
 * 表は候補日程の並びで固定しておくほうが与件として読みやすく、並べ替えると切り替え
 * 前後の見比べができなくなるので、順序を変えるのは根拠の側だけにする。評点の無い
 * 候補日程は末尾に落ちる。
 */
export function byScoreDesc(
  assessments: readonly CandidateAssessment[],
): CandidateAssessment[] {
  return [...assessments].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * AI の提案を職員の選択へ写す。
 *
 * 開催日の初期選択は**「推奨」のうち最高評点**（ADR-0007）で、AI には訊かない。
 * 訊けば評点と食い違う組が返る。「推奨」が1つも無ければ選択を動かさない — 無理に
 * 1つ選ぶと、AI が推していない候補日程に「AIが生成」の印が付く。
 *
 * **手で選んだ候補日程は上書きしない**（#38 の判断）。ラベルは表の側に全件出るので、
 * AI が何を推したかは決定を上書きしなくても読める。
 *
 * 守ったことは `ApplyReport` に載せる。**`message` では代われない** — あれはモデルが
 * 書いた文であって、画面が実際にラジオを動かしたかどうかは保証しない。職員から見ると
 * 「AI提案を押したのに選択が変わらない」ので、言わないと AI が推奨を出せなかったのか
 * 自分の選択が守られたのかが区別できない。
 */
export function applyRecommendation(
  input: RecommendScheduleInput,
  evaluations: readonly CandidateEvaluation[],
  held: Decision | null,
  meetingInfo: MeetingInfo,
): {
  decision: Decision | null;
  report: ApplyReport;
  selection: ScheduleSelection;
} {
  const selection = initialSelection(input, evaluations);
  const scored = `評点 ${evaluations.length}件`;

  if (held?.source === "manual") {
    return {
      decision: held,
      report: { updated: [scored], preserved: ["自分で選んだ候補日程"] },
      selection,
    };
  }

  const { hostCandidateId } = selection;
  if (hostCandidateId === null) {
    return {
      decision: held,
      report: { updated: [scored], preserved: [] },
      selection,
    };
  }
  return {
    decision: { candidateId: hostCandidateId, source: "ai" },
    report: {
      updated: [
        scored,
        `開催日 ${candidateLabelOf(input.candidates, hostCandidateId, meetingInfo)}`,
      ],
      preserved: [],
    },
    selection,
  };
}
