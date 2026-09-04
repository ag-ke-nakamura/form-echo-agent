import type { ParseCandidatesOutput } from "@contracts/index.js";
import { candidateIdOf } from "@contracts/meeting";
import type { ApplyReport } from "../field-source";
import type { PreviewItem } from "./ai-preview";
import {
  type CalendarCandidate,
  type CalendarContext,
  type Slot,
  slotRejection,
} from "./candidate-calendar";
import { candidateLabel } from "./meeting-info";

/**
 * 候補日程タブの、AI の結果をカレンダーへ写すための組み立て（#38・#65・#69）。
 *
 * WHY 画面から切り離すか: **反映は加算**（設計書 5.1節）で、既に選んだ候補日程と
 * 重なる分は見送る。押す前のプレビューと押した後の反映が同じ答えを出すこと、
 * 見送った分が黙って消えないことは、応答を作り分けながら往復させない限り
 * 画面では確かめられない。
 *
 * 升目との変換とカレンダーの状態モデルは `candidate-calendar.ts`。受け付けの判定は
 * そこの `slotRejection` をそのまま引く — **クリックが断られる条件と1つの梯子**である。
 */

/** AI が新しく作った候補日程ひとつ（識別子を持たない。ADR-0005）。 */
type NewCandidate = ParseCandidatesOutput["candidates"][number];

/**
 * 反映したときにその候補日程がどうなるか。
 *
 * WHY プレビューと反映で共有するか: 見送る条件を2箇所に書くとプレビューが嘘になる
 * （押したら入ると見せて入らない、または入るのに入らないと見せる。ADR-0006 が
 * 閉じたかった経路）。
 */
type MergeOutcome = { added: true } | { added: false; reason: string };

/**
 * 応答の各候補日程を上から順に見て、加算されるかどうかを決める。
 *
 * 順に見るのは、**同じ応答の中で重なる候補日程**があり得るため（先に入れた分が
 * 次の判定の相手になる）。件数の上限も同じで、31件目から先は入らない。
 */
function planMerge(
  current: readonly CalendarCandidate[],
  candidates: readonly NewCandidate[],
  context: CalendarContext,
): MergeOutcome[] {
  const accepted: Slot[] = [...current];

  return candidates.map((candidate) => {
    const reason = slotRejection(accepted, candidate, context);
    if (reason !== null) return { added: false, reason };

    // 識別子はまだ配られていない（発番するのは反映のとき）。受け付けの判定が見るのは
    // 日付と開始時刻だけなので、升目のまま積む。
    accepted.push(candidate);
    return { added: true };
  });
}

/**
 * AI の結果をカレンダーの選択へ加算する（設計書 5.1節「既存の選択状態は保持」）。
 *
 * **潰さない。** 手で選んだ候補日程も、前の往復で AI が選んだ候補日程も残り、重なる
 * ものだけを見送る。作り直し（置き換え）をやめたのは、カレンダーでは職員が選んだ
 * ものが目に見えており、置き換えると自分のクリックが消える（#69 の受け入れ条件）。
 *
 * **カレンダーに描けない日時は受け入れない**（表示範囲の外・升目に載らない開始時刻）。
 * 置けない候補日程を抱えると、選択済み件数が画面に見えているものと合わなくなる。
 * そもそも返させないために表示範囲を与件として渡してあり（ADR-0005 の表）、ここは
 * モデルが約束を破った場合の網である。見送ったことは `skipped` で言う。
 */
export function applyAiCandidates(
  current: readonly CalendarCandidate[],
  result: ParseCandidatesOutput,
  context: CalendarContext,
  firstSequence: number,
): {
  candidates: CalendarCandidate[];
  report: ApplyReport;
  /** 次に配る連番。**反映した分だけ進む**（見送った分で番号を飛ばさない）。 */
  nextSequence: number;
} {
  const plan = planMerge(current, result.candidates, context);
  const candidates = [...current];
  const updated: string[] = [];
  const skipped: string[] = [];
  let sequence = firstSequence;

  result.candidates.forEach((candidate, index) => {
    const outcome = plan[index];
    const label = candidateLabel(candidate, context.durationMinutes);
    if (!outcome.added) {
      skipped.push(`${label}（${outcome.reason}）`);
      return;
    }
    candidates.push({
      ...candidate,
      id: candidateIdOf(sequence),
      source: "ai",
    });
    sequence += 1;
    updated.push(label);
  });

  const manualCount = current.filter(
    (candidate) => candidate.source === "manual",
  ).length;

  return {
    candidates,
    nextSequence: sequence,
    report: {
      updated,
      /*
        加算なので上書きは起きないが、**潰していないことを言う**。前の往復で AI が
        選んだ分は挙げない — 「手入力のため保持」と読ませる先ではない。
      */
      preserved:
        updated.length > 0 && manualCount > 0
          ? [`手で選んだ候補日程 ${manualCount}件`]
          : [],
      skipped,
    },
  };
}

/**
 * AI の結果をプレビューの一覧へ写す（ADR-0006、設計書 3.6.1節）。
 *
 * **値の欄を持たない**（`PreviewItem.value` を省く）。この一覧の行は「埋まらなかった
 * かもしれない欄」ではなく、AI が作った候補日程そのものである。0件だったことは行が
 * 1つも無いことで表れ、`previewTone` がそれを聞き返しとして読む。
 *
 * 加算で入らない候補日程には錠を付ける（`preserved`）。判定は反映と同じ `planMerge` を
 * 引く — 別に書くと、押したら入ると見せて入らない行ができる。理由も添える：既定の
 * 「手入力のため変更しません」では、重なりで見送ったのか件数で溢れたのかが分からない。
 *
 * key に添え字を混ぜるのは、AI が同じ日時を2件返しうるため。識別子はまだ配られて
 * いない（発番するのは反映のとき）ので、ここで一意なのは並びの位置だけ。
 */
export function newCandidatePreviewItems(
  current: readonly CalendarCandidate[],
  candidates: readonly NewCandidate[],
  context: CalendarContext,
): PreviewItem[] {
  const plan = planMerge(current, candidates, context);

  return candidates.map((candidate, index) => {
    const item = {
      key: `${index}-${candidate.date}-${candidate.start_time}`,
      label: candidateLabel(candidate, context.durationMinutes),
    };
    const outcome = plan[index];
    return outcome.added
      ? item
      : { ...item, preserved: true, preservedReason: outcome.reason };
  });
}
