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
 * 候補日提案タブの組み立て（#71・#72）。
 *
 * WHY 画面から切り離すか: ここにあるのは**AI の提案を職員の選択にどう写すか**という
 * 取り決めである（守る単位は「開催日と予備日の選択」。`CLAUDE.md` の表）。JSX の中に
 * 埋め込むと、手で選んでから提案が届く往復を人が繰り返さない限り確かめられない
 * （`availability-form.ts` の `applyAvailabilityResult` と同じ理由）。
 *
 * 評点からラベル・初期選択を導くのは契約側（`contracts/recommendation.ts`）で、ここが
 * 持つのは画面の都合だけ — 表示文字列、遅れて届いた応答の捨て方、そして職員の選択の
 * 遷移である。
 */

/**
 * 会議をどの日程で開くかの決定。**この画面で職員が触れるのはここだけ**で、
 * 参加可否表は読み取り専用の与件である。
 *
 * 候補日程は識別子で指す（ADR-0005）。評点そのものは持たない — 評点は AI の説明の
 * ための道具で、職員が手で作りたいものではない。非AI経路は「開催日を1つ、予備日を
 * 0個以上選ぶ」に留め、AI が付けたものと職員が選んだものが**同じ場所の同じ印**に
 * なるようにする。
 *
 * **`source` は選択全体に1つだけ持つ**（候補日程ごとには持たない）。設計書 6.2節が
 * 「ユーザーが変更した場合、AI の提案を完全に上書き」と決めており、開催日と予備日は
 * 「この日程で開く」という1つの判断の表裏だからである。候補日程ごとに印を持つと、
 * AI 由来の予備日のチェックを外した跡がどこにも残らず、次の提案でそれが復活する。
 *
 * `null` は**まだ誰も選んでいない**状態。AI が上書きしてよいかどうかを `source` だけで
 * 決めるので、初期状態を `"manual"` と書けない（AI の提案が永久に入らなくなる）。
 *
 * 形は契約側の `ScheduleSelection`（AI の提案）に出どころを足したものである。同じ2つの
 * 欄を書き下すと、契約が提案の形を変えたときに画面の選択だけが古い形のまま残る。
 */
export type ScheduleChoice = ScheduleSelection & {
  source: FieldSource | null;
};

export const INITIAL_CHOICE: ScheduleChoice = {
  hostCandidateId: null,
  backupCandidateIds: [],
  source: null,
};

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

/** 欠席者の実名をこの人数まで並べ、超えたぶんは数に畳む（設計書 4.5.2節）。 */
export const ABSENT_NAMES_SHOWN = 5;

/**
 * 欠席者の行（設計書 4.5.2節、ストーリー62）。**実名を出す**（ADR-0008）。
 *
 * 名簿が大きい会議では実名が行を埋め尽くし、同じ根拠の中にある参加可能人数や
 * 未回答者数まで読めなくなる。誰が出られないかは先頭の数名で見当が付くので、
 * 残りは「他N名」に畳む。
 */
export function absentText(names: readonly string[]): string {
  if (names.length === 0) return "なし";
  if (names.length <= ABSENT_NAMES_SHOWN) return names.join("、");
  return `${names.slice(0, ABSENT_NAMES_SHOWN).join("、")} 他${names.length - ABSENT_NAMES_SHOWN}名`;
}

/**
 * 根拠を並べる順（評点の高い順）。
 *
 * 表は候補日程の並びで固定しておくほうが与件として読みやすく、並べ替えると切り替え
 * 前後の見比べができなくなるので、順序を変えるのは候補ブロックの側だけにする。評点の
 * 無い候補日程は末尾に落ちる。
 */
export function byScoreDesc(
  assessments: readonly CandidateAssessment[],
): CandidateAssessment[] {
  return [...assessments].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * 候補ブロックを「そのまま並べるもの」と「折りたたむもの」に分ける（設計書 5節）。
 *
 * **折りたたむのは「条件合わず」だけ。** 設計書 5.1節は「参加入力未済」も入れるかを
 * 実装時の判断に委ねているが、入れない — あれは候補日程の良し悪しではなく**回答が
 * 集まっていないという事実**であり、隠すと「まだ動く余地がある候補日程」が画面から
 * 消える。回答が途中の表では全件がそれになるので、隠せばリストが空になってしまう。
 *
 * ラベルの無い候補日程（提案の前）も折りたたまない。落とすと、提案が届く前の画面が
 * 「全件が条件合わず」に見える。
 */
export function splitRejected(assessments: readonly CandidateAssessment[]): {
  shown: CandidateAssessment[];
  rejected: CandidateAssessment[];
} {
  const ordered = byScoreDesc(assessments);
  return {
    shown: ordered.filter((entry) => entry.label !== "rejected"),
    rejected: ordered.filter((entry) => entry.label === "rejected"),
  };
}

/**
 * 初期展開する根拠の候補日程（設計書 4.5節、ストーリー65）。「推奨」だけを開く。
 *
 * 全部開くとスクロールが長く、閉じたままだと職員が最初に読むべき理由に辿り着けない。
 * 開くのは AI が最も推した1件だけでよい。
 */
export function initialOpenGrounds(
  assessments: readonly CandidateAssessment[],
): string[] {
  return assessments
    .filter((entry) => entry.label === "recommended")
    .map((entry) => entry.metrics.candidateId);
}

/** AI提案バナーの書式（設計書 3.2節・3.3節）。 */
export type BannerTone = "info" | "warning";

/**
 * バナーを警告の書式に変える条件。
 *
 * 設計書 3.3節は「全ての候補が『条件合わず』」と書いているが、判定は**AI が推せる
 * 候補日程が1つも無いこと**で採る。「要検討」だけが並ぶ表もその一例で、そこで青い枠に
 * 「推奨: なし ／ 予備: なし」と出るのは結論を伝えていない — 職員が読みたいのは
 * 「AI からは決められなかったので自分で選んでほしい」という一文である。
 */
export function bannerTone(selection: ScheduleSelection): BannerTone {
  return selection.hostCandidateId === null &&
    selection.backupCandidateIds.length === 0
    ? "warning"
    : "info";
}

/** 開催日を選ぶ。**同じ候補日程を予備日に残さない**（ストーリー68）。 */
export function chooseHost(
  choice: ScheduleChoice,
  candidateId: string,
): ScheduleChoice {
  return {
    hostCandidateId: candidateId,
    /*
      チェックボックスを無効化するだけでは、既に入っていたチェックがそのまま残る。
      画面には「開催日でもあり予備日でもある候補日程」が出て、確定の内容もそうなる。
    */
    backupCandidateIds: choice.backupCandidateIds.filter(
      (id) => id !== candidateId,
    ),
    source: "manual",
  };
}

/** 予備日を足す／外す。開催日は予備日にできないので、その候補日程は素通しする。 */
export function toggleBackup(
  choice: ScheduleChoice,
  candidateId: string,
): ScheduleChoice {
  if (candidateId === choice.hostCandidateId) return choice;
  const held = choice.backupCandidateIds.includes(candidateId);
  return {
    ...choice,
    backupCandidateIds: held
      ? choice.backupCandidateIds.filter((id) => id !== candidateId)
      : [...choice.backupCandidateIds, candidateId],
    source: "manual",
  };
}

/**
 * AI の提案を職員の選択へ写す。
 *
 * 初期選択は**開催日＝「推奨」のうち最高評点、予備日＝「予備に提案」**（ADR-0007）で、
 * AI には訊かない。訊けば評点と食い違う組が返る。どちらも導けなければ選択を動かさない
 * — 無理に1つ選ぶと、AI が推していない候補日程に「AIが生成」の印が付く。
 *
 * **手で選んだ選択は上書きしない**（#38 の判断）。ラベルは候補ブロックに全件出るので、
 * AI が何を推したかは選択を上書きしなくても読める。
 *
 * 守ったことは `ApplyReport` に載せる。**`message` では代われない** — あれはモデルが
 * 書いた文であって、画面が実際にラジオを動かしたかどうかは保証しない。職員から見ると
 * 「提案が届いたのに選択が変わらない」ので、言わないと AI が推奨を出せなかったのか
 * 自分の選択が守られたのかが区別できない。
 */
export function applyRecommendation(
  input: RecommendScheduleInput,
  evaluations: readonly CandidateEvaluation[],
  held: ScheduleChoice,
  meetingInfo: MeetingInfo,
): {
  choice: ScheduleChoice;
  report: ApplyReport;
  selection: ScheduleSelection;
} {
  const selection = initialSelection(input, evaluations);
  const scored = `評点 ${evaluations.length}件`;

  if (held.source === "manual") {
    return {
      choice: held,
      report: { updated: [scored], preserved: ["自分で選んだ開催日と予備日"] },
      selection,
    };
  }

  const { hostCandidateId, backupCandidateIds } = selection;
  if (hostCandidateId === null && backupCandidateIds.length === 0) {
    return {
      choice: held,
      report: { updated: [scored], preserved: [] },
      selection,
    };
  }

  const labelOf = (candidateId: string) =>
    candidateLabelOf(input.candidates, candidateId, meetingInfo);
  return {
    choice: { hostCandidateId, backupCandidateIds, source: "ai" },
    report: {
      updated: [
        scored,
        ...(hostCandidateId === null
          ? []
          : [`開催日 ${labelOf(hostCandidateId)}`]),
        ...(backupCandidateIds.length === 0
          ? []
          : [`予備日 ${backupCandidateIds.map(labelOf).join("、")}`]),
      ],
      preserved: [],
    },
    selection,
  };
}

/** 確認ダイアログと完了メッセージが読む、確定の中身（設計書 6.3節）。 */
export type ConfirmationSummary = {
  hostLabel: string;
  backupLabels: string[];
  /** AI の提案と違う選択のときだけ、AI が提案した内容を書いた一文。 */
  differenceNote: string | null;
};

/** 確定の画面で開催日が選ばれていないときの表示。ダイアログの中でだけ出る。 */
const NO_HOST = "未選択";

/**
 * 選択が空であることの表示。**「未選択」と書き分ける** — こちらは選べたのに選ばれて
 * いないのではなく、AI が推せなかった／予備日を確保しないという答えである。
 */
export const NO_SELECTION = "なし";

/** 候補日程の表示名を1行にする。空なら「なし」。 */
export function labelsText(labels: readonly string[]): string {
  return labels.length === 0 ? NO_SELECTION : labels.join("、");
}

/**
 * AI提案バナーに出す推奨・予備日の要約（設計書 3.2節、ストーリー59）。
 *
 * WHY 画面から切り離すか: 同じ「空なら『なし』、あれば読点で連ねる」をバナーと確認
 * ダイアログと完了メッセージの3箇所が要る。JSX に書き写すと、書式が3通りに割れる。
 */
export function selectionText(
  selection: ScheduleSelection,
  candidates: readonly TableCandidate[],
  meetingInfo: MeetingInfo,
): { hostText: string; backupText: string } {
  const labelOf = (candidateId: string) =>
    candidateLabelOf(candidates, candidateId, meetingInfo);
  return {
    hostText:
      selection.hostCandidateId === null
        ? NO_SELECTION
        : labelOf(selection.hostCandidateId),
    backupText: labelsText(selection.backupCandidateIds.map(labelOf)),
  };
}

/**
 * 確定しようとしている内容をまとめる（ストーリー70）。
 *
 * **AI の提案と違っても止めない**（ストーリー69）。違うことを言うだけにする —
 * 最終判断は人間であり、ダイアログの役目は選択を差し戻すことではなく、AI の提案から
 * 離れたことを職員が自覚した状態で確定させることである。
 *
 * 予備日は候補日程の並びに直してから比べる。チェックした順で持っているので、同じ
 * 組み合わせでも順序が違うだけで「AI と違う選択」になってしまう。
 */
export function confirmationSummary(
  choice: ScheduleChoice,
  proposed: ScheduleSelection | null,
  candidates: readonly TableCandidate[],
  meetingInfo: MeetingInfo,
): ConfirmationSummary {
  const inOrder = (candidateIds: readonly string[]) =>
    candidates
      .filter((candidate) => candidateIds.includes(candidate.id))
      .map((candidate) => candidate.id);

  const labelOf = (candidateId: string) =>
    candidateLabelOf(candidates, candidateId, meetingInfo);
  const backupIds = inOrder(choice.backupCandidateIds);

  return {
    hostLabel:
      choice.hostCandidateId === null
        ? NO_HOST
        : labelOf(choice.hostCandidateId),
    backupLabels: backupIds.map(labelOf),
    differenceNote:
      proposed === null ||
      (proposed.hostCandidateId === choice.hostCandidateId &&
        inOrder(proposed.backupCandidateIds).join() === backupIds.join())
        ? null
        : proposalNote(proposed, candidates, meetingInfo),
  };
}

/** AI が提案した内容を書いた一文。職員の選択がそこから離れたときだけ出す。 */
function proposalNote(
  proposed: ScheduleSelection,
  candidates: readonly TableCandidate[],
  meetingInfo: MeetingInfo,
): string {
  const { hostText, backupText } = selectionText(
    proposed,
    candidates,
    meetingInfo,
  );
  return `AI の提案（開催日: ${hostText} ／ 予備日: ${backupText}）とは違う選択です。`;
}

/** 確定したことを画面内に残す一文（永続化も送信APIも作らない。#72）。 */
export function confirmedText(summary: ConfirmationSummary): string {
  return `開催日を ${summary.hostLabel} に確定しました。予備日: ${labelsText(summary.backupLabels)}`;
}
