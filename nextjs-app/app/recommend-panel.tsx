"use client";

import type {
  CandidateAssessment,
  RecommendScheduleOutput,
  ScheduleSelection,
  TableCandidate,
} from "@contracts/index.js";
// 値として引くのはこの2つのモジュールだけ（理由は `ai-assistant.tsx` の同じ import）。
import { isAttending } from "@contracts/meeting";
import {
  type AiEvaluationLabel,
  assessCandidates,
  shouldRequestRecommendation,
} from "@contracts/recommendation";
import { Info } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { AiErrorNotice, AiPendingNotice, ApplyReportView } from "./ai-notice";
import { AiBadge, type ApplyReport } from "./field-source";
import { FormSection } from "./form-section";
import { RECOMMEND_TASK_ID, requestAiTask } from "./lib/api";
import {
  type AvailabilityTable,
  generateAvailabilityTable,
  INITIAL_TABLE_SEED,
  participantNameOf,
  type TableMode,
  tableInput,
} from "./lib/availability-table";
import {
  applyRecommendation,
  attendanceText,
  byScoreDesc,
  candidateLabel,
  candidateLabelOf,
  currentValue,
  type Decision,
  type ForTable,
} from "./lib/recommend-form";
import { type ErrorGuidance, errorGuidanceFor } from "./lib/error-guidance";
import {
  AI_EVALUATION_LABELS,
  AVAILABILITY_LABELS,
  type MeetingInfo,
} from "./lib/meeting-info";
import { TabHeading } from "./screen-layout";

/**
 * AI評価ラベルの chip の配色（設計書 4.3節）。
 *
 * 「条件合わず」と「参加入力未済」が同じ灰色なのは設計書のままである。前者は
 * 評価の結果で後者は評価の不在だが、どちらも「今は検討しない」という同じ扱いを
 * 受けるので、色で分ける理由が無い（語そのものが違いを言っている）。
 */
const LABEL_CHIP_CLASS: Record<AiEvaluationLabel, string> = {
  recommended: "bg-solid-blue-100 text-solid-blue-900",
  backup: "bg-solid-green-100 text-solid-green-900",
  consider: "bg-solid-yellow-100 text-solid-yellow-900",
  rejected: "bg-solid-gray-100 text-solid-gray-700",
  unanswered: "bg-solid-gray-100 text-solid-gray-700",
};

/** 非AI経路の一文。失敗の案内に添える（他タブは `AiAssistant` の prop で渡す）。 */
const NON_AI_PATH_HINT = "AI を使わなくても、表から候補日程を1つ選べます。";

/** 回答が揃っていないときの通知（設計書 10.3節、ストーリー71）。 */
const NOT_ENOUGH_ANSWERS =
  "回答が揃っていないため、AI提案は表示されません。回答が集まってから提案を求めてください。";

export function RecommendPanel({ meetingInfo }: { meetingInfo: MeetingInfo }) {
  const [tableSeed, setTableSeed] = useState(INITIAL_TABLE_SEED);
  const [tableMode, setTableMode] = useState<TableMode>("complete");
  const table = useMemo(
    () => generateAvailabilityTable(tableSeed, tableMode),
    [tableSeed, tableMode],
  );
  const input = useMemo(
    () =>
      tableInput(table, {
        meeting_format: meetingInfo.format,
        duration_minutes: meetingInfo.durationMinutes,
      }),
    [table, meetingInfo.format, meetingInfo.durationMinutes],
  );

  const [evaluations, setEvaluations] = useState<ForTable<
    RecommendScheduleOutput["evaluations"]
  > | null>(null);
  const [message, setMessage] = useState<ForTable<string> | null>(null);
  const [selection, setSelection] =
    useState<ForTable<ScheduleSelection> | null>(null);
  const [report, setReport] = useState<ForTable<ApplyReport> | null>(null);
  const [decision, setDecision] = useState<ForTable<Decision> | null>(null);
  const [pending, setPending] = useState(false);
  const [guidance, setGuidance] = useState<ForTable<ErrorGuidance> | null>(
    null,
  );

  const shownEvaluations = currentValue(evaluations, tableSeed);
  const shownMessage = currentValue(message, tableSeed);
  const shownSelection = currentValue(selection, tableSeed);
  const shownReport = currentValue(report, tableSeed);
  const shownDecision = currentValue(decision, tableSeed);
  const shownGuidance = currentValue(guidance, tableSeed);

  /**
   * 参加可否表から数えたものと、AI の評点から導いたラベルを候補日程ごとに束ねる。
   *
   * **数えるのは契約側の関数で、AI ではない**（ADR-0007）。提案の前でも呼べるので、
   * 表が描く内容は「提案が来たかどうか」で分岐しない — ラベルが増えるだけになる。
   */
  const assessments = useMemo(
    () => assessCandidates(input, shownEvaluations),
    [input, shownEvaluations],
  );
  const canRequest = shouldRequestRecommendation(input);

  /**
   * 送信ごとの連番。飛んでいるリクエストは止まらないので、表を切り替えた後に
   * 届いた結果で `pending` を下ろしたり案内を出したりしないために持つ。
   * 提案そのものは `ForTable` のシードで弾かれる。
   */
  const submitSerial = useRef(0);

  /** AI の提案をフォームへ写す。判断は `applyRecommendation`（`app/lib`）が持つ。 */
  function applyResult(result: RecommendScheduleOutput) {
    const applied = applyRecommendation(
      input,
      result.evaluations,
      currentValue(decision, tableSeed),
      meetingInfo,
    );
    setEvaluations({ seed: tableSeed, value: result.evaluations });
    setMessage({ seed: tableSeed, value: result.message });
    setSelection({ seed: tableSeed, value: applied.selection });
    setDecision(
      applied.decision === null
        ? null
        : { seed: tableSeed, value: applied.decision },
    );
    setReport({ seed: tableSeed, value: applied.report });
  }

  /**
   * AI に提案させる。
   *
   * **自然文の入力欄を持たない**（設計書のタブ4）。ここでの AI の提案は叩き台で
   * あって対話相手ではない、という位置づけを画面の形で示すため。送るのは会議情報と
   * 参加可否表（構造化入力。ADR-0005）だけで、`sessionId` も引き継がない
   * — 続きの会話が無い。**参加者は識別子だけを送る**（ADR-0008）。
   */
  async function requestRecommendation() {
    if (pending || !canRequest) return;
    const serial = ++submitSerial.current;
    const seed = tableSeed;
    setPending(true);
    setGuidance(null);

    const outcome = await requestAiTask({
      taskId: RECOMMEND_TASK_ID,
      prompt: null,
      sessionId: null,
      input,
    });
    if (serial !== submitSerial.current) return;

    if (outcome.ok) {
      applyResult(outcome.result);
    } else {
      setGuidance({ seed, value: errorGuidanceFor(outcome.code) });
    }
    setPending(false);
  }

  function reset() {
    submitSerial.current++;
    setPending(false);
    setEvaluations(null);
    setMessage(null);
    setSelection(null);
    setReport(null);
    setDecision(null);
    setGuidance(null);
  }

  /**
   * サンプルの参加可否表を「回答が揃った表 / 回答が途中の表」で切り替える
   * （ストーリー72）。
   *
   * 提案と決定を落とす。残すと、AI が書いた根拠が今の表と食い違ったまま並ぶ。
   * シードも振り直す — 同じモードへ戻ったときに前と同じ表が出ると、切り替えが
   * 何をしたのかが画面から読めない。
   */
  function switchTable() {
    setTableMode(tableMode === "complete" ? "partial" : "complete");
    setTableSeed(Math.floor(Math.random() * 2 ** 31));
    reset();
  }

  function chooseManually(candidateId: string) {
    setDecision({ seed: tableSeed, value: { candidateId, source: "manual" } });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <TabHeading>日程確定</TabHeading>

      {/*
        AI提案バナー（設計書 3節）。AI が書いた文であることが分かるよう青で囲う。
        推奨・予備日の要約は評点から導いたもので、AI が名指ししたものではない。
      */}
      {shownMessage !== null && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 rounded-lg border border-solid-blue-300 bg-solid-blue-50 p-4"
        >
          <p className="flex items-start gap-2 text-dns-16M-130 text-solid-gray-900">
            <Info
              aria-hidden="true"
              className="size-5 shrink-0 text-solid-blue-700"
            />
            {shownMessage}
          </p>
          {shownSelection !== null && (
            <SelectionSummary
              selection={shownSelection}
              table={table}
              meetingInfo={meetingInfo}
            />
          )}
          {shownReport !== null && <ApplyReportView report={shownReport} />}
        </div>
      )}

      <FormSection taskId={RECOMMEND_TASK_ID}>
        <p className="text-dns-14N-130 text-solid-gray-700">
          参加者から集まった参加可否表です。書き換えられません。AI
          を使わずに、開催する候補日程を1つ選ぶこともできます。
        </p>

        <AvailabilityTableView
          table={table}
          assessments={assessments}
          meetingInfo={meetingInfo}
          decision={shownDecision}
          onChoose={chooseManually}
        />

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={requestRecommendation}
            disabled={pending || !canRequest}
            className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
          >
            {pending ? "提案中..." : "AI提案"}
          </button>
          <button
            type="button"
            onClick={switchTable}
            className="rounded-md border border-solid-gray-600 bg-white px-4 py-2 text-dns-16M-130 text-solid-gray-900"
          >
            {tableMode === "complete"
              ? "回答が途中の表に切り替え"
              : "回答が揃った表に切り替え"}
          </button>
        </div>
        <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
          切り替えると参加可否表を作り直します。前の提案と選択は消えます。
        </p>

        {!canRequest && (
          <p
            role="status"
            className="mt-4 rounded-md border border-solid-yellow-300 bg-solid-yellow-50 p-3 text-dns-14N-130 text-solid-gray-900"
          >
            {NOT_ENOUGH_ANSWERS}
          </p>
        )}

        {pending && (
          <AiPendingNotice message="AIが候補日程を評価しています..." />
        )}

        {shownGuidance !== null && (
          <div className="mt-4">
            <AiErrorNotice
              guidance={shownGuidance}
              taskId={RECOMMEND_TASK_ID}
              nonAiPathHint={NON_AI_PATH_HINT}
            />
          </div>
        )}

        <GroundsList
          assessments={assessments}
          table={table}
          meetingInfo={meetingInfo}
        />
      </FormSection>
    </div>
  );
}

/** バナーに出す推奨・予備日の要約（設計書 3.2節、ストーリー59）。 */
function SelectionSummary({
  selection,
  table,
  meetingInfo,
}: {
  selection: ScheduleSelection;
  table: AvailabilityTable;
  meetingInfo: MeetingInfo;
}) {
  const labelOf = (candidateId: string) =>
    candidateLabelOf(table.candidates, candidateId, meetingInfo);
  const backups = selection.backupCandidateIds.map(labelOf);

  return (
    <dl className="ml-4 mt-2 grid gap-1 text-dns-14N-130 text-solid-gray-700">
      <div className="flex gap-2">
        <dt>推奨:</dt>
        <dd>
          {selection.hostCandidateId === null
            ? "なし"
            : labelOf(selection.hostCandidateId)}
        </dd>
      </div>
      <div className="flex gap-2">
        <dt>予備:</dt>
        <dd>{backups.length === 0 ? "なし" : backups.join("、")}</dd>
      </div>
    </dl>
  );
}

/** AI評価ラベルの chip。ラベルが導けていない候補日程には何も出さない。 */
function LabelChip({ label }: { label: AiEvaluationLabel | null }) {
  if (label === null) {
    return <span className="text-solid-gray-600">—</span>;
  }
  return (
    <span
      className={`rounded px-2 py-1 text-dns-12M-130 ${LABEL_CHIP_CLASS[label]}`}
    >
      {AI_EVALUATION_LABELS[label]}
    </span>
  );
}

type AvailabilityTableViewProps = {
  table: AvailabilityTable;
  assessments: CandidateAssessment[];
  meetingInfo: MeetingInfo;
  decision: Decision | null;
  onChoose: (candidateId: string) => void;
};

function AvailabilityTableView({
  table,
  assessments,
  meetingInfo,
  decision,
  onChoose,
}: AvailabilityTableViewProps) {
  // ラジオは表全体でひとつのグループ。会議は1つの日程で開くので、印も1つでよい。
  const groupName = useId();
  // 識別子で引く。並びが揃っていることに頼ると、集計の並べ替えが入った瞬間に
  // 行と数が静かにずれる（型検査では捕まらない）。
  const assessmentOf = new Map(
    assessments.map((assessment) => [
      assessment.metrics.candidateId,
      assessment,
    ]),
  );

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-dns-14N-130 text-solid-gray-900">
        <thead>
          <tr className="border-b border-solid-gray-300 text-left">
            <th scope="col" className="py-2 pr-3 text-dns-14M-130">
              開催
            </th>
            <th scope="col" className="py-2 pr-3 text-dns-14M-130">
              候補日程
            </th>
            {/* 列見出しは実名。名簿はブラウザの中にあり、Runtime へは送らない（ADR-0008）。 */}
            {table.participants.map((participant) => (
              <th
                key={participant.id}
                scope="col"
                className="py-2 pr-3 text-center text-dns-14M-130"
              >
                {participant.name}
              </th>
            ))}
            <th scope="col" className="py-2 pr-3 text-center text-dns-14M-130">
              参加可能
            </th>
            <th scope="col" className="py-2 text-center text-dns-14M-130">
              AI評価
            </th>
          </tr>
        </thead>
        <tbody>
          {table.candidates.map((candidate) => {
            const assessment = assessmentOf.get(candidate.id);
            const chosen = decision?.candidateId === candidate.id;
            return (
              <tr key={candidate.id} className="border-b border-solid-gray-100">
                <td className="py-2 pr-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={groupName}
                      checked={chosen}
                      onChange={() => onChoose(candidate.id)}
                    />
                    <span className="sr-only">
                      {candidateLabel(candidate, meetingInfo)}で開催する
                    </span>
                    {chosen && decision?.source === "ai" && <AiBadge />}
                  </label>
                </td>
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  {candidateLabel(candidate, meetingInfo)}
                </th>
                {table.participants.map((participant) => (
                  <td key={participant.id} className="py-2 pr-3 text-center">
                    <AnswerCell
                      candidate={candidate}
                      participantId={participant.id}
                    />
                  </td>
                ))}
                <td className="py-2 pr-3 text-center tabular-nums">
                  {assessment === undefined
                    ? "—"
                    : attendanceSummary(assessment, meetingInfo)}
                </td>
                <td className="py-2 text-center">
                  <LabelChip label={assessment?.label ?? null} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 参加可能人数の表示。**内訳を出すのはハイブリッドの会議だけ**（設計書 4.5.1節）。
 *
 * 現地のみ／オンラインのみの会議では出席のしかたが1通りしかないので、内訳は
 * 「4名（現地4名/リモート0名）」のように人数を2度言うだけになる。参加形式に
 * 合わない回答は画面側で正規化される前提（`availability-form.ts`）なので、
 * 0 の側が意味を持つこともない。
 */
function attendanceSummary(
  assessment: CandidateAssessment,
  meetingInfo: MeetingInfo,
): string {
  return meetingInfo.format === "hybrid"
    ? attendanceText(assessment.metrics)
    : `${assessment.metrics.attendCount}名`;
}

/**
 * セルひとつ。**未回答を回答と書き分ける**（ストーリー11）。
 *
 * 表は疎で、未回答はセルが存在しないことで表される（ADR-0004）。「まだ答えていない
 * 参加者」を欠席として描くと、職員も AI も見ている表が「全員参加できない候補日程」に
 * 化ける。未定（答えたが決まっていない）とも書き分ける（`CONTEXT.md`「未定」）。
 */
function AnswerCell({
  candidate,
  participantId,
}: {
  candidate: TableCandidate;
  participantId: string;
}) {
  const answer = candidate.answers.find(
    (entry) => entry.participant === participantId,
  );
  if (answer === undefined) {
    return <span className="text-dns-12N-130 text-solid-gray-600">未回答</span>;
  }
  return (
    <span
      className={
        isAttending(answer.availability)
          ? "text-dns-14M-130 text-solid-gray-900"
          : "text-dns-14N-130 text-solid-gray-600"
      }
    >
      {AVAILABILITY_LABELS[answer.availability]}
    </span>
  );
}

/**
 * 候補日程ごとの内訳と、AI が書いた根拠（ストーリー4・5・6・62・63・64）。
 *
 * **提案の前でも出す。** 内訳は参加可否表から数えたもので、AI を待つ理由が無い —
 * 回答が揃っていない表（AI 提案が発火しない）でも欠席者と未回答者数は読める。
 * AI の根拠だけが提案の後に増える。
 *
 * 評点の高い順に並べる。表は候補日程の並びで固定しておくほうが与件として読みやすく、
 * 並べ替えると切り替え前後の見比べができなくなるので、順序を変えるのはこちらだけに
 * する。落ちた候補日程の根拠こそが職員の知りたいものなので、上位だけを出すことは
 * しない（折りたたみは #72 が入れる）。
 *
 * **欠席者は実名で出す**（ADR-0008）。AI が返すのは識別子だけなので、名簿で解決するのは
 * 画面の仕事である。
 */
function GroundsList({
  assessments,
  table,
  meetingInfo,
}: {
  assessments: CandidateAssessment[];
  table: AvailabilityTable;
  meetingInfo: MeetingInfo;
}) {
  const ordered = byScoreDesc(assessments);
  return (
    <section className="mt-8">
      <h3 className="text-dns-16M-130 text-solid-gray-900">
        候補日程ごとの内訳
      </h3>
      <ol className="mt-3 grid gap-3">
        {ordered.map((assessment) => {
          const { metrics } = assessment;
          return (
            <li
              key={metrics.candidateId}
              className="rounded-md border border-solid-gray-300 p-3"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <LabelChip label={assessment.label} />
                <span className="text-dns-14N-130 text-solid-gray-900">
                  {candidateLabelOf(
                    table.candidates,
                    metrics.candidateId,
                    meetingInfo,
                  )}
                </span>
              </div>
              <dl className="mt-2 grid gap-1 text-dns-12N-130 text-solid-gray-700">
                <div className="flex gap-2">
                  <dt>参加可能:</dt>
                  <dd className="tabular-nums">
                    {attendanceSummary(assessment, meetingInfo)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt>欠席:</dt>
                  <dd>
                    {metrics.absentParticipants.length === 0
                      ? "なし"
                      : metrics.absentParticipants
                          .map((id) => participantNameOf(table, id))
                          .join("、")}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt>未回答:</dt>
                  <dd className="tabular-nums">{metrics.unansweredCount}名</dd>
                </div>
              </dl>
              {assessment.comment !== null && (
                <p className="mt-2 text-dns-14N-130 text-solid-gray-700">
                  {assessment.comment}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
