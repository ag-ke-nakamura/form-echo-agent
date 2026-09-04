import type { ParseCandidatesOutput } from "@contracts/index.js";
import type { PreviewItem } from "./ai-preview";
import { candidateLabel } from "./availability-form";
import type { CandidateTime } from "./meeting-info";

/**
 * 候補日程タブの、AI の結果を読むための組み立て（#38・#65）。
 *
 * WHY 画面から切り離すか: プレビューの一覧も反映の報告も「前後で何が入れ替わったか」
 * を言う計算で、応答を何度も往復させない限り画面には出ない。フォームの状態モデルと
 * 発番（`useCandidateRows`）はタブ側に残す — あちらは React の状態で閉じている。
 */

/**
 * AI が新しく作った候補日程ひとつ（識別子を持たない。ADR-0005）。
 *
 * 契約の形をそのまま引く。`CandidateTime` と構造は同じだが、こちらは**契約が決める
 * もの**で、欄が増えたときに型検査をここまで届かせたい。
 */
type NewCandidate = ParseCandidatesOutput["candidates"][number];

/**
 * AI の結果をプレビューの一覧へ写す（ADR-0006、設計書 3.6.1節）。
 *
 * **値の欄を持たない**（`PreviewItem.value` を省く）。この一覧の行は「埋まらなかった
 * かもしれない欄」ではなく、AI が作った候補日程そのものである。0件だったことは行が
 * 1つも無いことで表れ、`previewTone` がそれを聞き返しとして読む。
 *
 * key に添え字を混ぜるのは、AI が同じ日時を2件返しうるため。識別子はまだ配られて
 * いない（発番するのは反映のとき）ので、ここで一意なのは並びの位置だけ。
 */
export function newCandidatePreviewItems(
  candidates: readonly NewCandidate[],
  durationMinutes: number,
): PreviewItem[] {
  return candidates.map((candidate, index) => ({
    key: `${index}-${candidate.date}-${candidate.start_time}`,
    label: candidateLabel(candidate, durationMinutes),
  }));
}

/**
 * 作り直しで何が入れ替わったかを言う。
 *
 * WHY: 件数だけだと「水曜は避けたい」で何が外れたのかが分からず、10件が10件に
 * 変わったときは**変わっていないのと見分けが付かない**。他のタブは項目名を挙げる
 * ので、ここも日付を挙げて揃える。写像そのものは素直な代入のままで、これは報告の
 * ためだけの計算（#23: 写像に条件分岐を育てない）。
 *
 * 時刻だけが動いた場合も拾うため、変化の有無は日付ではなく日付と開始時刻の組で見る。
 *
 * 受けるのは行そのものではなく日付と開始時刻に落としたもの。行の形（`CandidateRow`）は
 * タブが持つ状態モデルなので、`app/lib` から掘りに行かない — 落とす側をタブに置けば、
 * 状態モデルが変わったときに直す場所も状態モデルの隣で済む。
 */
export function describeChange(
  replaced: readonly CandidateTime[],
  candidates: readonly NewCandidate[],
): string[] {
  const before = replaced.map(
    (candidate) => `${candidate.date} ${candidate.start_time}`,
  );
  const after = candidates.map(
    (candidate) => `${candidate.date} ${candidate.start_time}`,
  );
  if (
    before.length === after.length &&
    before.every((s, i) => s === after[i])
  ) {
    return [];
  }

  const beforeDates = replaced.map((candidate) => candidate.date);
  const afterDates = candidates.map((candidate) => candidate.date);
  const added = afterDates.filter((date) => !beforeDates.includes(date));
  const removed = beforeDates.filter((date) => !afterDates.includes(date));

  const changes: string[] = [];
  if (added.length > 0) changes.push(`追加 ${added.join("・")}`);
  if (removed.length > 0) changes.push(`削除 ${removed.join("・")}`);
  // 日付の出入りが無く時刻だけ動いた場合。上の突き合わせは通っているので何かは変わっている。
  if (changes.length === 0) changes.push("時刻を変更");

  return [`候補日程 ${afterDates.length}件（${changes.join("、")}）`];
}
