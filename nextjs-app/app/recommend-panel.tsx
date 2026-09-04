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
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Info,
  MessageSquare,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  absentText,
  applyRecommendation,
  attendanceText,
  type BannerTone,
  bannerTone,
  candidateLabel,
  candidateLabelOf,
  chooseHost,
  type ConfirmationSummary,
  confirmationSummary,
  confirmedText,
  currentValue,
  type ForTable,
  INITIAL_CHOICE,
  initialOpenGrounds,
  labelsText,
  type ScheduleChoice,
  selectionText,
  splitRejected,
  toggleBackup,
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

/**
 * 候補ブロックの枠。AI が推した候補日程だけ強調する（設計書 4.1節）。
 *
 * ラベルの無い候補日程（提案の前）も含めて1つの関数に畳む。`Record` を引く側で
 * `null` を捌くと、同じ既定値が呼び出し箇所の数だけ散る。
 */
function blockBorderClass(label: AiEvaluationLabel | null): string {
  switch (label) {
    case "recommended":
      return "border-2 border-solid-blue-500";
    case "backup":
      return "border border-solid-green-500";
    default:
      return "border border-solid-gray-300";
  }
}

/** 非AI経路の一文。失敗の案内に添える（他タブは `AiAssistant` の prop で渡す）。 */
const NON_AI_PATH_HINT =
  "AI を使わなくても、開催日と予備日を自分で選んで確定できます。";

/** 回答が揃っていないときの通知（設計書 10.3節、ストーリー71）。 */
const NOT_ENOUGH_ANSWERS =
  "回答が揃っていないため、AI提案は表示されません。回答が集まってから開き直してください。";

/** 全て却下だったときの代替メッセージ（設計書 3.3節）。 */
const NO_SUITABLE_CANDIDATE =
  "回答結果から適切な候補日程を見つけられませんでした。全ての候補を確認し、手動で選択してください。";

/** 折りたたみの中の候補日程も選べることを言う（設計書 5.2節、ストーリー67）。 */
const REJECTED_STILL_SELECTABLE =
  "これらの候補は参加可能人数が少ないため却下候補となっていますが、状況に応じて選択することも可能です。";

export function RecommendPanel({
  meetingInfo,
  active,
}: {
  meetingInfo: MeetingInfo;
  /**
   * このタブが表示されているか。**AI 推論を始める合図**（設計書 10.1節）。
   *
   * WHY prop で受けるか: タブは全部描かれたまま `hidden` で隠されている
   * （`form-echo-tabs.tsx`）ので、マウントを合図にすると**ページを読み込んだだけで
   * 推論が走る** — 職員がこのタブを一度も開かなくても Runtime を叩くことになる。
   * 設計書の言う「画面初回表示時」はこの検証環境ではタブが開かれた時である。
   */
  active: boolean;
}) {
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
  const [choice, setChoice] = useState<ForTable<ScheduleChoice> | null>(null);
  const [pending, setPending] = useState(false);
  const [guidance, setGuidance] = useState<ForTable<ErrorGuidance> | null>(
    null,
  );
  /**
   * 展開している根拠。`null` は「職員がまだ触っていない」で、そのときは AI の提案から
   * 導いた初期展開（「推奨」だけ）を出す。
   *
   * WHY 導出を state に焼かないか: 提案が届く前と後で「推奨」が変わるので、届いた
   * 時点の値を持つと、提案の到着とアコーディオンの初期状態を2箇所で同期させることに
   * なる。触るまでは導出のまま置き、触った時点で explicit な集合へ変わる。
   */
  const [openGrounds, setOpenGrounds] = useState<string[] | null>(null);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState<ForTable<string> | null>(null);

  const shownEvaluations = currentValue(evaluations, tableSeed);
  const shownMessage = currentValue(message, tableSeed);
  const shownSelection = currentValue(selection, tableSeed);
  const shownReport = currentValue(report, tableSeed);
  const shownGuidance = currentValue(guidance, tableSeed);
  const shownConfirmed = currentValue(confirmed, tableSeed);
  const shownChoice = currentValue(choice, tableSeed) ?? INITIAL_CHOICE;

  /**
   * 参加可否表から数えたものと、AI の評点から導いたラベルを候補日程ごとに束ねる。
   *
   * **数えるのは契約側の関数で、AI ではない**（ADR-0007）。提案の前でも呼べるので、
   * 画面が描く内容は「提案が来たかどうか」で分岐しない — ラベルが増えるだけになる。
   */
  const assessments = useMemo(
    () => assessCandidates(input, shownEvaluations),
    [input, shownEvaluations],
  );
  const canRequest = shouldRequestRecommendation(input);
  const shownOpenGrounds = openGrounds ?? initialOpenGrounds(assessments);
  const { shown, rejected } = splitRejected(assessments);

  /**
   * 送信ごとの連番。飛んでいるリクエストは止まらないので、表を切り替えた後に
   * 届いた結果で `pending` を下ろしたり案内を出したりしないために持つ。
   * 提案そのものは `ForTable` のシードで弾かれる。
   */
  const submitSerial = useRef(0);

  /**
   * 最新の選択。
   *
   * WHY: 推論を待っている間も職員は開催日と予備日を選べる（ストーリー73）。写す時点で
   * クロージャが掴んだ古い選択を見ると、**待っている間の手入力を AI 由来と誤認して
   * 踏み潰す**（`ai-assistant.tsx` の `handlers` と同じ理由）。
   */
  const choiceRef = useRef(shownChoice);
  useEffect(() => {
    choiceRef.current = shownChoice;
  }, [shownChoice]);

  /**
   * AI に提案させる。
   *
   * **自然文の入力欄を持たない**（設計書のタブ4）。ここでの AI の提案は叩き台で
   * あって対話相手ではない、という位置づけを画面の形で示すため。送るのは会議情報と
   * 参加可否表（構造化入力。ADR-0005）だけで、`sessionId` も引き継がない
   * — 続きの会話が無い。**参加者は識別子だけを送る**（ADR-0008）。
   */
  const requestRecommendation = useCallback(async () => {
    if (!canRequest) return;
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
      // 判断は `applyRecommendation`（`app/lib`）が持つ。
      const applied = applyRecommendation(
        input,
        outcome.result.evaluations,
        choiceRef.current,
        meetingInfo,
      );
      setEvaluations({ seed, value: outcome.result.evaluations });
      setMessage({ seed, value: outcome.result.message });
      setSelection({ seed, value: applied.selection });
      setChoice({ seed, value: applied.choice });
      setReport({ seed, value: applied.report });
      // 新しい提案が来たらアコーディオンを導出へ戻す（「推奨」だけが開く）。
      setOpenGrounds(null);
    } else {
      setGuidance({ seed, value: errorGuidanceFor(outcome.code) });
    }
    setPending(false);
  }, [canRequest, input, meetingInfo, tableSeed]);

  /**
   * この表でもう推論を始めたか。**選択を変えても再推論しない**（設計書 10.1節）ので、
   * 発火の合図は「表示されたこと」と「表が変わったこと」だけになる。
   */
  const startedSeed = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !canRequest || startedSeed.current === tableSeed) return;
    startedSeed.current = tableSeed;
    void requestRecommendation();
  }, [active, canRequest, tableSeed, requestRecommendation]);

  /**
   * サンプルの参加可否表を「回答が揃った表 / 回答が途中の表」で切り替える
   * （ストーリー72）。
   *
   * 提案と選択を落とす。残すと、AI が書いた根拠が今の表と食い違ったまま並ぶ。
   * シードも振り直す — 同じモードへ戻ったときに前と同じ表が出ると、切り替えが
   * 何をしたのかが画面から読めない。
   */
  function switchTable() {
    submitSerial.current++;
    startedSeed.current = null;
    setTableMode(tableMode === "complete" ? "partial" : "complete");
    /*
      提案と選択を1つずつ `null` に戻さない。**シードを振り直すことがそのまま消去で
      ある**（`ForTable` を持っている理由。描画時に `currentValue` が弾く）。戻す形に
      すると、表に紐づく state を足すたびにここへの追加を忘れる余地が増える。
      シードに紐づかないもの（進行中・アコーディオン・ダイアログ）だけを戻す。
    */
    setTableSeed(Math.floor(Math.random() * 2 ** 31));
    setPending(false);
    setOpenGrounds(null);
    setRejectedOpen(false);
    setConfirming(false);
  }

  function updateChoice(next: ScheduleChoice) {
    setChoice({ seed: tableSeed, value: next });
    /*
      確定した後に選び直したら完了メッセージを下ろす。残すと、画面に出ている
      「確定しました」がラジオの状態と食い違う。
    */
    setConfirmed(null);
  }

  function toggleGrounds(candidateId: string) {
    setOpenGrounds(
      shownOpenGrounds.includes(candidateId)
        ? shownOpenGrounds.filter((id) => id !== candidateId)
        : [...shownOpenGrounds, candidateId],
    );
  }

  const summary = confirmationSummary(
    shownChoice,
    shownSelection,
    table.candidates,
    meetingInfo,
  );

  const blockProps = {
    table,
    meetingInfo,
    choice: shownChoice,
    openGrounds: shownOpenGrounds,
    onChooseHost: (candidateId: string) =>
      updateChoice(chooseHost(shownChoice, candidateId)),
    onToggleBackup: (candidateId: string) =>
      updateChoice(toggleBackup(shownChoice, candidateId)),
    onToggleGrounds: toggleGrounds,
  };

  return (
    <div className="mx-auto max-w-4xl">
      <TabHeading>日程確定</TabHeading>

      {pending && <AiPendingNotice message="AIが候補日程を評価しています..." />}

      {shownSelection !== null && (
        <ProposalBanner
          tone={bannerTone(shownSelection)}
          message={shownMessage}
          selection={shownSelection}
          report={shownReport}
          table={table}
          meetingInfo={meetingInfo}
        />
      )}

      {!canRequest && (
        <p
          role="status"
          className="mb-6 rounded-md border border-solid-yellow-700 bg-solid-yellow-50 p-3 text-dns-14N-130 text-solid-gray-900"
        >
          {NOT_ENOUGH_ANSWERS}
        </p>
      )}

      {shownGuidance !== null && (
        <div className="mb-6">
          <AiErrorNotice
            guidance={shownGuidance}
            taskId={RECOMMEND_TASK_ID}
            nonAiPathHint={NON_AI_PATH_HINT}
          />
          {/*
            失敗したときに出すのはやり直しの1つだけ（設計書 10.2節、ストーリー73）。
            下の候補ブロックは生きているので、AI が落ちても手で選んで確定できる。
          */}
          <button
            type="button"
            onClick={() => void requestRecommendation()}
            disabled={pending}
            className="mt-3 rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
          >
            AI提案をやり直す
          </button>
        </div>
      )}

      <FormSection taskId={RECOMMEND_TASK_ID}>
        <p className="text-dns-14N-130 text-solid-gray-700">
          参加者から集まった参加可否表です。書き換えられません。AI
          の提案は叩き台なので、開催日と予備日は自由に選び直せます。
        </p>

        <AvailabilityTableView
          table={table}
          assessments={assessments}
          meetingInfo={meetingInfo}
        />

        <div className="mt-6">
          <button
            type="button"
            onClick={switchTable}
            className="rounded-md border border-solid-gray-600 bg-white px-4 py-2 text-dns-16M-130 text-solid-gray-900"
          >
            {tableMode === "complete"
              ? "回答が途中の表に切り替え"
              : "回答が揃った表に切り替え"}
          </button>
          <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
            切り替えると参加可否表を作り直し、AI提案をやり直します。前の提案と選択は消えます。
          </p>
        </div>

        {/*
          開催日のラジオと予備日のチェックボックスは候補ブロックの中で交互に現れる。
          設計書 9.2節は `role="radiogroup"` と `role="group"` を別々に求めているが、
          この並びでは1つの入れ物にどちらのロールも正しくは付けられない（間に別種の
          操作が挟まる）。`<fieldset>` と `<legend>` なら嘘にならず、支援技術には
          「ここからが開催日と予備日の選択」が伝わる。
        */}
        <fieldset className="mt-8">
          <legend className="text-dns-16M-130 text-solid-gray-900">
            候補日程一覧（開催日と予備日の選択）
          </legend>

          <ol className="mt-3">
            {shown.map((assessment) => (
              <CandidateBlock
                key={assessment.metrics.candidateId}
                assessment={assessment}
                {...blockProps}
              />
            ))}
          </ol>

          {rejected.length > 0 && (
            <RejectedSection
              rejected={rejected}
              open={rejectedOpen}
              onToggle={() => setRejectedOpen(!rejectedOpen)}
              blockProps={blockProps}
            />
          )}
        </fieldset>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {/*
            キャンセルは置かない。設計書 2.1節は [キャンセル][確定する] を並べるが、
            この検証環境には戻る先の画面が無く、押しても何も起きないボタンになる。
          */}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={shownChoice.hostCandidateId === null}
            className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
          >
            確定する
          </button>
          {shownChoice.hostCandidateId === null && (
            <span className="text-dns-12N-130 text-solid-gray-600">
              開催日を1つ選ぶと確定できます。
            </span>
          )}
        </div>

        {shownConfirmed !== null && (
          <p
            role="status"
            aria-live="polite"
            className="mt-4 rounded-md border border-solid-green-500 bg-solid-green-100 p-4 text-dns-16M-130 text-solid-gray-900"
          >
            {shownConfirmed}
          </p>
        )}
      </FormSection>

      {confirming && (
        <ConfirmDialog
          summary={summary}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            // 永続化も送信APIも作らない（#72）。画面内に結果を残すところまで。
            setConfirmed({ seed: tableSeed, value: confirmedText(summary) });
          }}
        />
      )}
    </div>
  );
}

/**
 * AI提案バナー（設計書 3節）。AI が書いた文であることが分かるよう青で囲う。
 *
 * 推奨・予備日の要約は評点から導いたもので、AI が名指ししたものではない。推せる
 * 候補日程が1つも無いときは黄色の代替メッセージに変わる（設計書 3.3節） — AI の
 * `message` もそこでは出さない。あれは「提案しました」と書かれた文なので、何も
 * 提案できなかったことの説明にはならない。
 */
function ProposalBanner({
  tone,
  message,
  selection,
  report,
  table,
  meetingInfo,
}: {
  tone: BannerTone;
  message: string | null;
  selection: ScheduleSelection;
  report: ApplyReport | null;
  table: AvailabilityTable;
  meetingInfo: MeetingInfo;
}) {
  const warning = tone === "warning";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-6 rounded-lg p-4 ${
        warning
          ? "border border-solid-yellow-700 bg-solid-yellow-50"
          : "border border-solid-blue-300 bg-solid-blue-50"
      }`}
    >
      <p className="flex items-start gap-2 text-dns-16M-130 text-solid-gray-900">
        {warning ? (
          <AlertTriangle
            aria-hidden="true"
            className="size-5 shrink-0 text-solid-yellow-700"
          />
        ) : (
          <Info
            aria-hidden="true"
            className="size-5 shrink-0 text-solid-blue-700"
          />
        )}
        {warning ? NO_SUITABLE_CANDIDATE : message}
      </p>
      {!warning && (
        <SelectionSummary
          selection={selection}
          table={table}
          meetingInfo={meetingInfo}
        />
      )}
      {report !== null && <ApplyReportView report={report} />}
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
  const { hostText, backupText } = selectionText(
    selection,
    table.candidates,
    meetingInfo,
  );

  return (
    <dl className="ml-4 mt-2 grid gap-1 text-dns-14N-130 text-solid-gray-700">
      <div className="flex gap-2">
        <dt>推奨:</dt>
        <dd>{hostText}</dd>
      </div>
      <div className="flex gap-2">
        <dt>予備:</dt>
        <dd>{backupText}</dd>
      </div>
    </dl>
  );
}

/**
 * AI評価ラベルの chip。ラベルが導けていない候補日程には何も出さない。
 *
 * `aria-label` は設計書 9.2節の指定。字面だけだと、その語が候補日程の状態なのか
 * AI の評価なのかが読み上げでは分からない。
 */
function LabelChip({ label }: { label: AiEvaluationLabel | null }) {
  if (label === null) {
    return <span className="text-solid-gray-600">—</span>;
  }
  return (
    <span
      aria-label={`AI評価: ${AI_EVALUATION_LABELS[label]}`}
      className={`rounded px-2 py-1 text-dns-12M-130 ${LABEL_CHIP_CLASS[label]}`}
    >
      {AI_EVALUATION_LABELS[label]}
    </span>
  );
}

type BlockProps = {
  table: AvailabilityTable;
  meetingInfo: MeetingInfo;
  choice: ScheduleChoice;
  openGrounds: string[];
  onChooseHost: (candidateId: string) => void;
  onToggleBackup: (candidateId: string) => void;
  onToggleGrounds: (candidateId: string) => void;
};

/**
 * 候補日程ひとつのブロック（設計書 4節）。開催日のラジオ・予備日のチェックボックス・
 * 根拠のアコーディオンが縦に並ぶ。
 *
 * ラジオは画面全体で1つのグループ（会議は1つの日程で開くので印も1つでよい）。
 * `name` に固定の文字列を書くのはそのため — ブロックごとに `useId` を呼ぶと、
 * 候補日程の数だけ独立したラジオグループができて全部にチェックが入る。
 */
function CandidateBlock({
  assessment,
  table,
  meetingInfo,
  choice,
  openGrounds,
  onChooseHost,
  onToggleBackup,
  onToggleGrounds,
}: BlockProps & { assessment: CandidateAssessment }) {
  const groundsId = useId();
  const candidateId = assessment.metrics.candidateId;
  const label = candidateLabelOf(table.candidates, candidateId, meetingInfo);
  const isHost = choice.hostCandidateId === candidateId;
  const isBackup = choice.backupCandidateIds.includes(candidateId);
  const open = openGrounds.includes(candidateId);
  const fromAi = choice.source === "ai";

  return (
    <li
      className={`mb-4 rounded-lg bg-white p-4 ${blockBorderClass(assessment.label)}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-2 text-dns-16M-130 text-solid-gray-900">
          <input
            type="radio"
            name="host-candidate"
            checked={isHost}
            onChange={() => onChooseHost(candidateId)}
          />
          {label}
        </label>
        <LabelChip label={assessment.label} />
        {isHost && fromAi && <AiBadge />}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-2 text-dns-14N-130 text-solid-gray-700">
          <input
            type="checkbox"
            checked={isBackup}
            /* 開催日に選んだ候補日程は予備日にできない（ストーリー68）。 */
            disabled={isHost}
            onChange={() => onToggleBackup(candidateId)}
          />
          予備日として確保
        </label>
        {/* バッジはラベルの外に置く。中に入れると読み上げが「予備日として確保AIが生成」になる。 */}
        {isBackup && fromAi && <AiBadge />}
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={groundsId}
        onClick={() => onToggleGrounds(candidateId)}
        className="mt-3 flex items-center gap-1 text-dns-14N-130 text-solid-blue-700 underline"
      >
        {open ? (
          <ChevronUp aria-hidden="true" className="size-4" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-4" />
        )}
        {open ? "根拠を隠す" : "根拠を表示"}
      </button>

      <div id={groundsId} hidden={!open}>
        <Grounds
          assessment={assessment}
          table={table}
          meetingInfo={meetingInfo}
        />
      </div>
    </li>
  );
}

/**
 * 根拠の中身（設計書 4.5節、ストーリー4・5・6・62・63・64）。
 *
 * **提案の前でも数字は出る。** 内訳は参加可否表から数えたもので、AI を待つ理由が無い —
 * 回答が揃っていない表（AI 提案が発火しない）でも欠席者と未回答者数は読める。
 * AI の理由だけが提案の後に増える。
 *
 * **欠席者と未回答者の行は0名でも出す。** 設計書 4.5.2節・4.5.3節は1名以上のときだけ
 * 出すと書いているが、根拠は説明責任のための表示であり、「誰も欠席していない」こと
 * 自体が開催日を選ぶ理由になる。行が消えると、0名なのか数えていないのかが画面から
 * 区別できない。
 */
function Grounds({
  assessment,
  table,
  meetingInfo,
}: {
  assessment: CandidateAssessment;
  table: AvailabilityTable;
  meetingInfo: MeetingInfo;
}) {
  const { metrics } = assessment;
  return (
    <div className="mt-3 border-t border-solid-gray-300 bg-solid-gray-50 p-4">
      <dl className="grid gap-2">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" className="size-4 text-success-1" />
          <dt className="text-dns-14N-130 text-solid-gray-700">参加可能:</dt>
          <dd className="text-dns-16M-130 text-solid-gray-900 tabular-nums">
            {attendanceSummary(assessment, meetingInfo)}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <X aria-hidden="true" className="size-4 text-error-1" />
          <dt className="text-dns-14N-130 text-solid-gray-700">欠席:</dt>
          <dd className="text-dns-14N-130 text-solid-gray-700">
            {/* 実名で出す（ADR-0008）。AI が返すのは識別子だけなので、名簿で解決するのは画面の仕事。 */}
            {absentText(
              metrics.absentParticipants.map((id) =>
                participantNameOf(table, id),
              ),
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <HelpCircle
            aria-hidden="true"
            className="size-4 text-solid-gray-600"
          />
          <dt className="text-dns-14N-130 text-solid-gray-600">未回答:</dt>
          <dd className="text-dns-14N-130 text-solid-gray-600 tabular-nums">
            {metrics.unansweredCount}名
          </dd>
        </div>
      </dl>
      {assessment.comment !== null && (
        <p className="mt-3 flex items-start gap-2 border-l-4 border-solid-blue-700 bg-solid-blue-50 p-3 text-dns-14N-130 text-solid-gray-900">
          <MessageSquare
            aria-hidden="true"
            className="size-4 shrink-0 text-solid-blue-700"
          />
          {assessment.comment}
        </p>
      )}
    </div>
  );
}

/**
 * 「条件が合わない候補」の折りたたみ（設計書 5節、ストーリー66・67）。
 *
 * 中の候補日程も選べる。**AI の判定は最終ではない**ので、閉じているのは検討の
 * 優先度を落としているだけであって、選択肢から外しているのではない。
 */
function RejectedSection({
  rejected,
  open,
  onToggle,
  blockProps,
}: {
  rejected: CandidateAssessment[];
  open: boolean;
  onToggle: () => void;
  blockProps: BlockProps;
}) {
  const listId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        /*
          設計書 9.2節は `aria-label="条件が合わない候補"` を指定しているが、付けない。
          可視ラベルは件数と開閉を語っており（「…を表示（2件）」/「…を隠す」）、
          `aria-label` はそれを丸ごと置き換えてしまう。読み上げからだけ件数が消える。
        */
        onClick={onToggle}
        className="flex items-center gap-1 text-dns-16N-130 text-solid-gray-700"
      >
        {open ? (
          <ChevronUp aria-hidden="true" className="size-4" />
        ) : (
          <ChevronDown aria-hidden="true" className="size-4" />
        )}
        {open
          ? "条件が合わない候補を隠す"
          : `条件が合わない候補を表示（${rejected.length}件）`}
      </button>

      <div id={listId} hidden={!open}>
        <p className="mb-4 mt-3 rounded-md bg-solid-gray-50 p-3 text-dns-14N-130 text-solid-gray-600">
          {REJECTED_STILL_SELECTABLE}
        </p>
        <ol>
          {rejected.map((assessment) => (
            <CandidateBlock
              key={assessment.metrics.candidateId}
              assessment={assessment}
              {...blockProps}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * 確定の確認ダイアログ（設計書 6.3節、ストーリー70）。
 *
 * **AI の提案と違っても止めない**（ストーリー69）。違うことを書くだけにする —
 * 最終判断は人間であり、ダイアログの役目は選択を差し戻すことではなく、AI の提案から
 * 離れたことを職員が自覚した状態で確定させることである。
 *
 * `<dialog>` を `showModal()` で開くのは、フォーカスの閉じ込めと Esc をブラウザに
 * 任せるため。自前の div で組むと、背後の候補ブロックへ Tab で抜けられる。
 */
function ConfirmDialog({
  summary,
  onCancel,
  onConfirm,
}: {
  summary: ConfirmationSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      /* Esc で閉じたときも state を戻す（閉じたダイアログが残り続けないように）。 */
      onClose={onCancel}
      className="m-auto max-w-lg rounded-lg border border-solid-gray-300 bg-white p-6 backdrop:bg-solid-gray-900/40"
    >
      <h3 id={titleId} className="text-std-20M-150 text-solid-gray-900">
        この内容で日程を確定しますか？
      </h3>
      <dl className="mt-4 grid gap-2 text-dns-14N-130 text-solid-gray-900">
        <div className="flex gap-2">
          <dt className="shrink-0 text-solid-gray-600">開催日</dt>
          <dd>{summary.hostLabel}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-solid-gray-600">予備日</dt>
          <dd>{labelsText(summary.backupLabels)}</dd>
        </div>
      </dl>
      {summary.differenceNote !== null && (
        <p className="mt-4 rounded-md border border-solid-yellow-700 bg-solid-yellow-50 p-3 text-dns-14N-130 text-solid-gray-900">
          {summary.differenceNote}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white"
        >
          確定する
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-solid-gray-600 bg-white px-4 py-2 text-dns-16M-130 text-solid-gray-900"
        >
          選び直す
        </button>
      </div>
    </dialog>
  );
}

/**
 * 参加可否表（設計書には無いが #71 が与件の表示として置いたもの）。**読み取り専用。**
 *
 * 開催日と予備日の選択は候補ブロック（`CandidateBlock`）が持つ。同じ選択を表にも
 * 置くと、折りたたまれた「条件が合わない候補」だけ選べる場所が2つになる。
 */
function AvailabilityTableView({
  table,
  assessments,
  meetingInfo,
}: {
  table: AvailabilityTable;
  assessments: CandidateAssessment[];
  meetingInfo: MeetingInfo;
}) {
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
            return (
              <tr key={candidate.id} className="border-b border-solid-gray-100">
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
