"use client";

import type { RecommendScheduleOutput } from "@contracts/index.js";
// 値として引くのはこのモジュールだけ（理由は `ai-assistant.tsx` の同じ import）。
import { type Availability, isAttending } from "@contracts/meeting";
import { Info } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { AiErrorNotice, AiPendingNotice, ApplyReportView } from "./ai-notice";
import { AiBadge, type ApplyReport, type FieldSource } from "./field-source";
import { FormSection } from "./form-section";
import { RECOMMEND_TASK_ID, requestAiTask } from "./lib/api";
import {
  type AvailabilityTable,
  countAttending,
  generateAvailabilityTable,
  INITIAL_TABLE_SEED,
  type TableCandidate,
} from "./lib/availability-table";
import { type ErrorGuidance, errorGuidanceFor } from "./lib/error-guidance";
import { candidateRangeText, type MeetingInfo } from "./lib/meeting-info";
import { TabHeading } from "./screen-layout";

/**
 * 会議をどの日程で開くかの決定。**この画面で職員が触れるのはここだけ**で、
 * 参加可否表は読み取り専用の与件である。
 *
 * 候補日程は識別子で指す（ADR-0005）。3項目を連結した鍵を組み立てていたのは契約に
 * 識別子が無かったからで、その理由は消えた。
 *
 * 順位そのものは持たない。順位は AI の説明のための道具で、職員が手で作りたいものでは
 * ない（数値を手入力させると重複と抜けの検査 UI が要る）。非AI経路は「候補日程を
 * 1つ選ぶ」に留め、AI が付ける1位と職員が選んだものが**同じ場所の同じ印**になるよう
 * にする。どちらの判断で決まったかは `source` が持つ。
 */
type Decision = { candidateId: string; source: FieldSource };

/**
 * 表と、それに対して作られたもの（提案・決定）を組で持つ。
 *
 * WHY: 「別のサンプルに差し替え」は提案を消すことが強制である（表が変われば理由が
 * 事実と食い違う）。応答を待っている間に差し替えられる経路があるので、消すだけでは
 * 足りない — 古い表に対する応答が後から届いて新しい表の隣に並ぶ。シードを添えて
 * 描画時に照合すれば、遅れて届いた結果はどこにも出ない。
 */
type ForTable<T> = { seed: number; value: T };

function currentValue<T>(held: ForTable<T> | null, seed: number): T | null {
  return held !== null && held.seed === seed ? held.value : null;
}

/**
 * 候補日程の表示名。終わる時刻は会議の所要時間から導く（ADR-0005）。
 *
 * 識別子（`candidate-1`）はそのまま見せない。職員が読みたいのは日時であって、
 * 識別子は突き合わせのための内部の値である。
 */
function candidateLabel(
  candidate: TableCandidate,
  meetingInfo: MeetingInfo,
): string {
  return `${candidate.date} ${candidateRangeText(candidate.start_time, meetingInfo.durationMinutes)}`;
}

/**
 * 参加可否の表示。**未回答と書き分ける**ために語で書く（ストーリー11）。
 *
 * 記号（○×）に畳まない。4状態になった以上、○×の2記号では現地とリモート、欠席と
 * 未定を区別できず、職員と AI が見ている表が食い違う（`CONTEXT.md`「参加可否」）。
 */
const AVAILABILITY_LABELS: Record<Availability, string> = {
  attend_onsite: "現地",
  attend_remote: "リモート",
  absent: "欠席",
  undecided: "未定",
};

/** 非AI経路の一文。失敗の案内に添える（他タブは `AiAssistant` の prop で渡す）。 */
const NON_AI_PATH_HINT = "AI を使わなくても、表から候補日程を1つ選べます。";

export function RecommendPanel({ meetingInfo }: { meetingInfo: MeetingInfo }) {
  const [tableSeed, setTableSeed] = useState(INITIAL_TABLE_SEED);
  const table = useMemo(
    () => generateAvailabilityTable(tableSeed),
    [tableSeed],
  );

  const [recommendations, setRecommendations] = useState<ForTable<
    RecommendScheduleOutput["recommendations"]
  > | null>(null);
  const [message, setMessage] = useState<ForTable<string> | null>(null);
  const [report, setReport] = useState<ForTable<ApplyReport> | null>(null);
  const [decision, setDecision] = useState<ForTable<Decision> | null>(null);
  const [pending, setPending] = useState(false);
  const [guidance, setGuidance] = useState<ForTable<ErrorGuidance> | null>(
    null,
  );

  const shownRecommendations = currentValue(recommendations, tableSeed);
  const shownMessage = currentValue(message, tableSeed);
  const shownReport = currentValue(report, tableSeed);
  const shownDecision = currentValue(decision, tableSeed);
  const shownGuidance = currentValue(guidance, tableSeed);

  /**
   * 送信ごとの連番。飛んでいるリクエストは止まらないので、表を差し替えた後に
   * 届いた結果で `pending` を下ろしたり案内を出したりしないために持つ。
   * 提案そのものは `ForTable` のシードで弾かれる。
   */
  const submitSerial = useRef(0);

  /**
   * AI の提案をフォームへ写す。
   *
   * 写像は素直に留める — 識別子で引いて順位と理由を出すだけで、条件分岐を育てない
   * （#23 の線引き）。提案が入力の候補日程と一致していることは BFF が検査済みなので、
   * ここで落ちた分を数える必要は無い（参加可否タブとの違い）。
   *
   * **手で選んだ候補日程は上書きしない**（#38 の判断）。1位が動いても職員の決定は
   * 残る。順位は表の側に全件出るので、AI が何を1位にしたかは決定を上書きしなくても読める。
   *
   * 守ったことは `ApplyReport` に載せる。**`message` では代われない** — あれは
   * モデルが書いた文であって、画面が実際にラジオを動かしたかどうかは保証しない。
   * 職員から見ると「AI提案を押したのに選択が変わらない」ので、言わないと AI が
   * 1位を出せなかったのか自分の選択が守られたのかが区別できない。
   */
  function applyResult(result: RecommendScheduleOutput) {
    setRecommendations({ seed: tableSeed, value: result.recommendations });
    setMessage({ seed: tableSeed, value: result.message });

    const ranked = `順位 ${result.recommendations.length}件`;
    const held = currentValue(decision, tableSeed);
    if (held?.source === "manual") {
      setReport({
        seed: tableSeed,
        value: { updated: [ranked], preserved: ["自分で選んだ候補日程"] },
      });
      return;
    }
    const top = result.recommendations.find((entry) => entry.rank === 1);
    const topCandidate = table.candidates.find(
      (candidate) => candidate.id === top?.candidate_id,
    );
    if (top) {
      setDecision({
        seed: tableSeed,
        value: { candidateId: top.candidate_id, source: "ai" },
      });
    }
    setReport({
      seed: tableSeed,
      value: {
        updated: [
          ranked,
          ...(topCandidate
            ? [`1位 ${candidateLabel(topCandidate, meetingInfo)}`]
            : []),
        ],
        preserved: [],
      },
    });
  }

  /**
   * AI に提案させる。
   *
   * **自然文の入力欄を持たない**（設計書のタブ4）。ここでの AI の提案は叩き台で
   * あって対話相手ではない、という位置づけを画面の形で示すため。送るのは会議情報と
   * 参加可否表（構造化入力。ADR-0005）だけで、`sessionId` も引き継がない
   * — 続きの会話が無い。
   */
  async function requestRecommendation() {
    if (pending) return;
    const serial = ++submitSerial.current;
    const seed = tableSeed;
    setPending(true);
    setGuidance(null);

    const outcome = await requestAiTask({
      taskId: RECOMMEND_TASK_ID,
      prompt: null,
      sessionId: null,
      input: {
        meeting_format: meetingInfo.format,
        duration_minutes: meetingInfo.durationMinutes,
        ...table,
      },
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
    setRecommendations(null);
    setMessage(null);
    setReport(null);
    setDecision(null);
    setGuidance(null);
  }

  /**
   * 別のサンプルの参加可否表に差し替える。
   *
   * 提案と決定を落とす。残すと、AI が書いた理由が今の表と食い違ったまま並ぶ。
   */
  function replaceTable() {
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
        推奨・予備日の要約と AI評価ラベルは #71 / #72 で評点から導く。
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
          meetingInfo={meetingInfo}
          recommendations={shownRecommendations}
          decision={shownDecision}
          onChoose={chooseManually}
        />

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={requestRecommendation}
            disabled={pending}
            className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
          >
            {pending ? "提案中..." : "AI提案"}
          </button>
          <button
            type="button"
            onClick={replaceTable}
            className="rounded-md border border-solid-gray-600 bg-white px-4 py-2 text-dns-16M-130 text-solid-gray-900"
          >
            別のサンプルに差し替え
          </button>
        </div>
        <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
          「別のサンプルに差し替え」は参加可否表を作り直します。前の提案と選択は消えます。
        </p>

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

        {shownRecommendations && (
          <ReasonList
            recommendations={shownRecommendations}
            table={table}
            meetingInfo={meetingInfo}
          />
        )}
      </FormSection>
    </div>
  );
}

type AvailabilityTableViewProps = {
  table: AvailabilityTable;
  meetingInfo: MeetingInfo;
  recommendations: RecommendScheduleOutput["recommendations"] | null;
  decision: Decision | null;
  onChoose: (candidateId: string) => void;
};

function AvailabilityTableView({
  table,
  meetingInfo,
  recommendations,
  decision,
  onChoose,
}: AvailabilityTableViewProps) {
  // ラジオは表全体でひとつのグループ。会議は1つの日程で開くので、印も1つでよい。
  const groupName = useId();
  const rankById = new Map(
    recommendations?.map((entry) => [entry.candidate_id, entry.rank]) ?? [],
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
            {table.participants.map((participant) => (
              <th
                key={participant}
                scope="col"
                className="py-2 pr-3 text-center text-dns-14M-130"
              >
                {participant}
              </th>
            ))}
            <th scope="col" className="py-2 pr-3 text-center text-dns-14M-130">
              参加可能
            </th>
            <th scope="col" className="py-2 text-center text-dns-14M-130">
              順位
            </th>
          </tr>
        </thead>
        <tbody>
          {table.candidates.map((candidate) => {
            const rank = rankById.get(candidate.id);
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
                  <td key={participant} className="py-2 pr-3 text-center">
                    <AnswerCell
                      candidate={candidate}
                      participant={participant}
                    />
                  </td>
                ))}
                <td className="py-2 pr-3 text-center tabular-nums">
                  {countAttending(candidate)}
                </td>
                <td className="py-2 text-center tabular-nums">
                  {rank === undefined ? (
                    <span className="text-solid-gray-600">—</span>
                  ) : (
                    <span
                      className={
                        rank === 1
                          ? "text-dns-14M-130 text-solid-blue-900"
                          : undefined
                      }
                    >
                      {rank}位
                    </span>
                  )}
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
 * セルひとつ。**未回答を回答と書き分ける**（ストーリー11）。
 *
 * 表は疎で、未回答はセルが存在しないことで表される（ADR-0004）。「まだ答えていない
 * 参加者」を欠席として描くと、職員も AI も見ている表が「全員参加できない候補日程」に
 * 化ける。未定（答えたが決まっていない）とも書き分ける（`CONTEXT.md`「未定」）。
 */
function AnswerCell({
  candidate,
  participant,
}: {
  candidate: TableCandidate;
  participant: string;
}) {
  const answer = candidate.answers.find(
    (entry) => entry.participant === participant,
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
 * 順位ごとの理由（ストーリー4・5・6）。
 *
 * 表とは別に順位の順で並べる。表は候補日程の並びで固定しておくほうが与件として
 * 読みやすく、順位の順に並べ替えると差し替え前後の見比べができなくなる。落ちた
 * 候補日程の理由こそが職員の知りたいものなので、上位だけを出すことはしない。
 *
 * AI が返すのは識別子なので、日時は表から引き直す。BFF が「入力に無い識別子」を
 * 弾いているので引けない提案はここまで来ないが、型の上では起こりうるので識別子を
 * そのまま出す経路を残す。
 */
function ReasonList({
  recommendations,
  table,
  meetingInfo,
}: {
  recommendations: RecommendScheduleOutput["recommendations"];
  table: AvailabilityTable;
  meetingInfo: MeetingInfo;
}) {
  const ordered = [...recommendations].sort((a, b) => a.rank - b.rank);
  return (
    <section className="mt-8">
      <h3 className="text-dns-16M-130 text-solid-gray-900">提案の理由</h3>
      <ol className="mt-3 grid gap-3">
        {ordered.map((entry) => {
          const candidate = table.candidates.find(
            (item) => item.id === entry.candidate_id,
          );
          return (
            <li
              key={entry.candidate_id}
              className="rounded-md border border-solid-gray-300 p-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-dns-14M-130 tabular-nums text-solid-gray-900">
                  {entry.rank}位
                </span>
                <span className="text-dns-14N-130 text-solid-gray-900">
                  {candidate
                    ? candidateLabel(candidate, meetingInfo)
                    : entry.candidate_id}
                </span>
              </div>
              <p className="mt-1 text-dns-14N-130 text-solid-gray-700">
                {entry.reason}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
