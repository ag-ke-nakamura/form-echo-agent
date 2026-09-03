"use client";

import type {
  CandidateFields,
  RecommendScheduleInput,
  RecommendScheduleOutput,
} from "@contracts/index.js";
// 値として引くのはこのモジュールだけ（理由は `ai-chat-panel.tsx` の同じ import）。
import { candidateKey } from "@contracts/candidate-key";
import { useId, useMemo, useState } from "react";
import { AiChatPanel } from "./ai-chat-panel";
import { AiBadge, type ApplyReport, type FieldSource } from "./field-source";
import { FormSection } from "./form-section";
import {
  countAvailable,
  generateAvailabilityTable,
  INITIAL_TABLE_SEED,
} from "./lib/availability-table";
import { RECOMMEND_TASK_ID } from "./lib/api";

/**
 * 会議をどの日程で開くかの決定。**この画面で職員が触れるのはここだけ**で、
 * 参加可否表は読み取り専用の与件である。
 *
 * 順位そのものは持たない。順位は AI の説明のための道具で、職員が手で作りたいものでは
 * ない（数値を手入力させると重複と抜けの検査 UI が要る）。非AI経路は「候補日程を
 * 1つ選ぶ」に留め、AI が付ける1位と職員が選んだものが**同じ場所の同じ印**になるよう
 * にする。どちらの判断で決まったかは `source` が持つ。
 */
type Decision = { key: string; source: FieldSource };

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

/** 候補日程の表示名。`candidateKey` は突き合わせ用なので、見せる形は別に持つ。 */
function candidateLabel(fields: CandidateFields): string {
  return `${fields.date} ${fields.start_time}–${fields.end_time}`;
}

export function RecommendPanel() {
  const [tableSeed, setTableSeed] = useState(INITIAL_TABLE_SEED);
  const table = useMemo(
    () => generateAvailabilityTable(tableSeed),
    [tableSeed],
  );

  const [recommendations, setRecommendations] = useState<ForTable<
    RecommendScheduleOutput["recommendations"]
  > | null>(null);
  const [decision, setDecision] = useState<ForTable<Decision> | null>(null);

  const shownRecommendations = currentValue(recommendations, tableSeed);
  const shownDecision = currentValue(decision, tableSeed);

  /**
   * AI の提案をフォームへ写す（ADR-0004 の突き合わせ）。
   *
   * 写像は素直に留める — 3項目の組で引いて順位と理由を出すだけで、条件分岐を育てない
   * （#23 の線引き）。提案が入力の候補日程と一致していることは BFF が検査済みなので、
   * ここで落ちた分を数える必要は無い（参加可否タブとの違い）。
   *
   * **手で選んだ候補日程は上書きしない**（#38 の判断）。1位が動いても職員の決定は
   * 残り、報告に「守った」と出る。順位は表の側に全件出るので、AI が何を1位にしたかは
   * 決定を上書きしなくても読める。
   */
  function applyResult(result: RecommendScheduleOutput): ApplyReport {
    setRecommendations({ seed: tableSeed, value: result.recommendations });

    const top = result.recommendations.find((entry) => entry.rank === 1);
    const held = currentValue(decision, tableSeed);
    if (held?.source === "manual") {
      return {
        updated: [`順位 ${result.recommendations.length}件`],
        preserved: ["自分で選んだ候補日程"],
      };
    }
    if (top) {
      setDecision({
        seed: tableSeed,
        value: { key: candidateKey(top), source: "ai" },
      });
    }
    return {
      updated: [
        `順位 ${result.recommendations.length}件`,
        ...(top ? [`1位 ${candidateLabel(top)}`] : []),
      ],
      preserved: [],
    };
  }

  function reset() {
    setRecommendations(null);
    setDecision(null);
  }

  /**
   * 別のサンプルの参加可否表に差し替える。
   *
   * 提案と決定を落とし、AI チャット欄も `key` で作り直してセッションを切る。
   * セッションを残すと、AI が「前は同じ候補日程を1位にした」という文脈を引きずった
   * まま新しい表を見る。
   */
  function replaceTable() {
    setTableSeed(Math.floor(Math.random() * 2 ** 31));
    reset();
  }

  function chooseManually(key: string) {
    setDecision({ seed: tableSeed, value: { key, source: "manual" } });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <FormSection taskId={RECOMMEND_TASK_ID}>
        <h2 className="text-lg font-semibold">候補日提案</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          参加者から集まった参加可否表です。書き換えられません。AI
          を使わずに、開催する候補日程を1つ選ぶこともできます。
        </p>

        <AvailabilityTable
          table={table}
          recommendations={shownRecommendations}
          decision={shownDecision}
          onChoose={chooseManually}
        />

        <button
          type="button"
          onClick={replaceTable}
          className="mt-6 rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
        >
          別のサンプルに差し替え
        </button>
        <p className="mt-1 text-xs text-black/45 dark:text-white/45">
          参加可否表を作り直します。前の提案と選択は消えます。
        </p>

        {shownRecommendations && (
          <ReasonList recommendations={shownRecommendations} />
        )}
      </FormSection>

      {/*
        表を差し替えたら会話も切る。`key` で作り直すのは、AI チャット欄が
        sessionId と会話ログを内側に持っているため（差し替え専用の口を開けるより、
        持ち主ごと入れ替えるほうが取りこぼしが無い）。
      */}
      <AiChatPanel
        key={tableSeed}
        taskId={RECOMMEND_TASK_ID}
        nonAiPathHint="AI を使わなくても、表から候補日程を1つ選べます。"
        description="参加可否表をもとに、AI が全候補日程に順位と理由を付けます。指示を書かずに「AI提案」を押すだけでも動きます。"
        placeholder="このまま「AI提案」を押せます。観点を足したいときだけ書いてください"
        followUpPlaceholder="参加人数より早い日程を優先して"
        input={table}
        submitLabel="AI提案"
        onResult={applyResult}
        onReset={reset}
      />
    </div>
  );
}

type AvailabilityTableProps = {
  table: RecommendScheduleInput;
  recommendations: RecommendScheduleOutput["recommendations"] | null;
  decision: Decision | null;
  onChoose: (key: string) => void;
};

function AvailabilityTable({
  table,
  recommendations,
  decision,
  onChoose,
}: AvailabilityTableProps) {
  // ラジオは表全体でひとつのグループ。会議は1つの日程で開くので、印も1つでよい。
  const groupName = useId();
  const rankByKey = new Map(
    recommendations?.map((entry) => [candidateKey(entry), entry.rank]) ?? [],
  );

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th scope="col" className="py-2 pr-3 font-medium">
              開催
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              候補日程
            </th>
            {table.participants.map((participant) => (
              <th
                key={participant}
                scope="col"
                className="py-2 pr-3 text-center font-medium"
              >
                {participant}
              </th>
            ))}
            <th scope="col" className="py-2 pr-3 text-center font-medium">
              ○の数
            </th>
            <th scope="col" className="py-2 text-center font-medium">
              順位
            </th>
          </tr>
        </thead>
        <tbody>
          {table.candidates.map((candidate) => {
            const key = candidateKey(candidate);
            const rank = rankByKey.get(key);
            const chosen = decision?.key === key;
            return (
              <tr
                key={key}
                className="border-b border-black/[.06] dark:border-white/[.08]"
              >
                <td className="py-2 pr-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={groupName}
                      checked={chosen}
                      onChange={() => onChoose(key)}
                    />
                    <span className="sr-only">
                      {candidateLabel(candidate)}で開催する
                    </span>
                    {chosen && decision?.source === "ai" && <AiBadge />}
                  </label>
                </td>
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  {candidateLabel(candidate)}
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
                  {countAvailable(candidate)}
                </td>
                <td className="py-2 text-center tabular-nums">
                  {rank === undefined ? (
                    <span className="text-black/35 dark:text-white/35">—</span>
                  ) : (
                    <span className={rank === 1 ? "font-semibold" : undefined}>
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
 * セルひとつ。**未回答を×と書き分ける**（ストーリー11）。
 *
 * 表は疎で、未回答はセルが存在しないことで表される（ADR-0004）。「まだ答えていない
 * 参加者」を×として描くと、職員も AI も見ている表が「全員参加できない候補日程」に
 * 化ける。記号ではなく語で書くのは、○×と並べたときに一目で別種と分かるようにするため。
 */
function AnswerCell({
  candidate,
  participant,
}: {
  candidate: RecommendScheduleInput["candidates"][number];
  participant: string;
}) {
  const answer = candidate.answers.find(
    (entry) => entry.participant === participant,
  );
  if (answer === undefined) {
    return (
      <span className="text-xs text-black/40 dark:text-white/40">未回答</span>
    );
  }
  return (
    <span aria-label={answer.available ? "参加できる" : "参加できない"}>
      {answer.available ? "○" : "×"}
    </span>
  );
}

/**
 * 順位ごとの理由（ストーリー4・5・6）。
 *
 * 表とは別に順位の順で並べる。表は候補日程の並びで固定しておくほうが与件として
 * 読みやすく、順位の順に並べ替えると差し替え前後の見比べができなくなる。落ちた
 * 候補日程の理由こそが職員の知りたいものなので、上位だけを出すことはしない。
 */
function ReasonList({
  recommendations,
}: {
  recommendations: RecommendScheduleOutput["recommendations"];
}) {
  const ordered = [...recommendations].sort((a, b) => a.rank - b.rank);
  return (
    <section className="mt-8">
      <h3 className="text-sm font-medium">提案の理由</h3>
      <ol className="mt-3 grid gap-3">
        {ordered.map((entry) => (
          <li
            key={candidateKey(entry)}
            className="rounded-md border border-black/10 p-3 text-sm dark:border-white/15"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium tabular-nums">{entry.rank}位</span>
              <span>{candidateLabel(entry)}</span>
            </div>
            <p className="mt-1 text-black/70 dark:text-white/70">
              {entry.reason}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
