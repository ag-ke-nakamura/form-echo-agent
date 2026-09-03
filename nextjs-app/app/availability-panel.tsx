"use client";

import type { ParseAvailabilityOutput } from "@contracts/index.js";
import { useId, useState } from "react";
import { AiChatPanel } from "./ai-chat-panel";
import { AiBadge, type FieldSource } from "./field-source";
import { AVAILABILITY_TASK_ID } from "./lib/api";

/**
 * 参加可否ひとつ。未回答は `null`、それ以外は出力契約の `available` をそのまま持つ。
 *
 * 画面独自の列挙（`"yes" | "no"`）にしない。出力契約が既に○×の2値なので、別の型を
 * 挟むと写像が単純な代入でなくなり、AI の出力とフォーム状態の間に変換が生まれる
 * （#23 Testing Decisions の「素直な代入に留める」）。
 */
type Answer = { choice: boolean | null; source: FieldSource };

type AvailabilityPanelProps = {
  /**
   * ○×を付ける対象の候補日程の日付。候補日程タブが持っているものを受け取る。
   *
   * WHY: このタブの AI は既にある候補日程へ○×を付けるだけで、候補日程そのものを
   * 作らない。対象が無ければ AI が何を答えても当てる先が無く、必ず空振りする。
   * 候補日程を作る場所はこの画面に既にあるので、そこから引く。
   */
  dates: readonly string[];
};

export function AvailabilityPanel({ dates }: AvailabilityPanelProps) {
  /**
   * 日付をキーにした参加可否。行の識別子を持たない。
   *
   * WHY: 候補日程の一覧はこのタブの持ち物ではないので、行を足し引きする側と
   * 番号を取り合わずに済む形にする。日付で引く限り、候補日程タブで並べ替えや
   * 追加が起きても職員が付けた○×はその日付に残る。
   */
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  /**
   * 直近の AI 応答が返した参加可否。**落ちた分を描画時に導くために持つ。**
   *
   * WHY: ADR-003 は Runtime に候補日程の一覧を渡さないと決めたので、AI が候補日程に
   * 無い日付を答える経路は必ず起きうる。落ちた分を確定させて持つと、職員がその日付を
   * 候補日程に足した後も「無い」と言い続ける。応答そのものを持って毎回突き合わせ直せば、
   * 表示は常に今の候補日程の一覧と一致する。
   */
  const [lastAnswers, setLastAnswers] = useState<
    ParseAvailabilityOutput["availability"]
  >([]);

  function setAnswer(date: string, choice: boolean) {
    setAnswers((current) => ({
      ...current,
      [date]: { choice, source: "manual" },
    }));
  }

  /**
   * AI が返した日付を候補日程の一覧に当てる（ADR-003 の突き合わせ）。
   *
   * 候補日程に無い日付は書き込まない。書き込むと、後からその日付が候補日程に
   * 足された瞬間に、職員が見ていない○×が現れることになる。
   */
  function applyResult(result: ParseAvailabilityOutput) {
    const known = new Set(dates);
    setAnswers((current) => {
      const next = { ...current };
      for (const entry of result.availability) {
        if (known.has(entry.date)) {
          next[entry.date] = { choice: entry.available, source: "ai" };
        }
      }
      return next;
    });
    setLastAnswers(result.availability);
  }

  // 突き合わせに失敗した分。状態として持たず今の候補日程の一覧から導くので、
  // 候補日程タブでその日付が足されればその場で消える。
  const known = new Set(dates);
  const dropped = lastAnswers.filter((entry) => !known.has(entry.date));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">参加可否回答</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          AI を使わずに、各候補日程に手で○×を付けられます。候補日程そのものは
          「会議候補日設定」タブで足し引きします。
        </p>

        {dropped.length > 0 && (
          <div
            role="status"
            className="mt-6 rounded-md border border-amber-500/40 p-3 text-sm"
          >
            <p className="font-medium">
              候補日程に無い日付があり、次の回答は反映されませんでした。
            </p>
            <ul className="mt-2 list-disc pl-5">
              {dropped.map((entry) => (
                <li key={entry.date}>
                  {entry.date} —{" "}
                  {entry.available ? "○（参加できる）" : "×（参加できない）"}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-black/60 dark:text-white/60">
              「会議候補日設定」タブでこの日付を足してからもう一度送るか、AI
              への指示を書き直してください。
            </p>
          </div>
        )}

        {dates.length === 0 ? (
          <p className="mt-6 text-sm text-black/60 dark:text-white/60">
            候補日程がまだありません。「会議候補日設定」タブで候補日程を作ると、
            ここに並んで○×を付けられるようになります。
          </p>
        ) : (
          <ul className="mt-6 grid gap-4">
            {dates.map((date, index) => (
              <li key={date}>
                <AvailabilityFields
                  date={date}
                  index={index}
                  answer={answers[date] ?? { choice: null, source: "manual" }}
                  onChange={setAnswer}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <AiChatPanel
        taskId={AVAILABILITY_TASK_ID}
        description="参加できる日・できない日を文章で書くと、左の候補日程に○×を付けます。「15日」のように月を省いた書き方は今日以降の直近の15日として解決されるので、別の月なら月から書いてください。"
        placeholder="15日と17日は大丈夫ですが16日は無理です"
        onResult={applyResult}
      />
    </div>
  );
}

type AvailabilityFieldsProps = {
  date: string;
  index: number;
  answer: Answer;
  onChange: (date: string, choice: boolean) => void;
};

const CHOICES = [
  { value: "yes", choice: true, label: "○ 参加できる" },
  { value: "no", choice: false, label: "× 参加できない" },
] as const;

function AvailabilityFields({
  date,
  index,
  answer,
  onChange,
}: AvailabilityFieldsProps) {
  // ラジオは1つの候補日程でひとつのグループにする。候補日程をまたいで同じ name に
  // なると、画面全体で1つしか選べなくなる。
  const groupName = useId();

  return (
    <div className="rounded-md border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">候補日程 {index + 1}</span>
        <span className="text-sm text-black/60 dark:text-white/60">{date}</span>
      </div>

      <fieldset className="mt-3">
        {/*
          印は候補日程の見出しではなく可否の側に付ける。日付は候補日程タブで職員が
          決めたものなので、全体に付けると「AI が日付も入れた」と読めてしまう。
        */}
        <legend className="flex items-center gap-2 text-xs text-black/60 dark:text-white/60">
          参加可否
          {answer.source === "ai" && <AiBadge />}
        </legend>
        <div className="mt-1 flex gap-4 py-2">
          {CHOICES.map(({ value, choice, label }) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={groupName}
                value={value}
                checked={answer.choice === choice}
                onChange={() => onChange(date, choice)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
