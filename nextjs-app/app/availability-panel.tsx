"use client";

import type { ParseAvailabilityOutput } from "@contracts/index.js";
import { Info } from "lucide-react";
import { useId, useState } from "react";
import { AiAssistant } from "./ai-assistant";
import type { SelectedCandidate } from "./candidates-panel";
import { AiBadge, type ApplyReport, type FieldSource } from "./field-source";
import { FormSection } from "./form-section";
import { AVAILABILITY_TASK_ID } from "./lib/api";
import { candidateRangeText, type MeetingInfo } from "./lib/meeting-info";
import { MeetingInfoHeader } from "./meeting-info";
import { ManualInputDivider, TabHeading } from "./screen-layout";

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
   * 参加可否を答える対象の候補日程。候補日程タブが持っているものを受け取る。
   *
   * WHY: このタブの AI は既にある候補日程へ可否を付けるだけで、候補日程そのものを
   * 作らない。対象が無ければ AI が何を答えても当てる先が無く、必ず空振りする。
   * 候補日程を作る場所はこの画面に既にあるので、そこから引く。
   *
   * **日付だけでなく識別子と開始時刻ごと受け取る**（ADR-0005）。この一覧をそのまま
   * 与件として Runtime へ渡すので、画面の表示に要る分だけに削ると渡せなくなる。
   */
  candidates: readonly SelectedCandidate[];
  /**
   * ヘッダーに出す会議情報。タブ2で職員が入れたものを受け取る。
   *
   * WHY: 参加者は「何の会議に答えているのか」を知らずにこの画面へ来る（本来は
   * メールのリンクから開く画面）。会議情報を持つのはタブ2なので、候補日程と同じ
   * 経路で受け取る。**書き換えはしない** — 参加者が会議の性質を変える画面ではない
   * ので、`MeetingInfoApi` ではなく値だけを受ける。
   */
  meetingInfo: MeetingInfo;
};

/*
  このタブの AI入力アシスタントの文言だけ `CONTEXT.md` の用語集と食い違う（用語集は
  「出欠」「○×」を _Avoid_ とし「参加可否」を正としている）。設計書が指定した文言を
  そのまま出すことが #73 の受け入れ条件で、ここは設計書の字面が優先する。参加可否が
  4状態になる #70 で設計書側の語も動くので、揃えるのはそのとき。
*/
export function AvailabilityPanel({
  candidates,
  meetingInfo,
}: AvailabilityPanelProps) {
  /*
    可否を付ける単位は日付のまま。出力契約が日付ごとに可否を返すので、同じ日付の
    候補日程が2つあってもこの画面に並ぶ行はひとつになる。**候補日程ごとの4状態と
    日付でのグループ化は #70 が担当する** — このチケットで替わったのは、AI へ渡す
    与件が識別子付きの一覧になったことだけ。
  */
  const dates = [...new Set(candidates.map((candidate) => candidate.date))];
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
   * WHY: 候補日程の一覧を与件として渡すようになった（ADR-0005）ので、AI が一覧に
   * 無い日付を答える余地はほぼ無い。それでも突き合わせを残すのは、落ちた分を黙って
   * 捨てないため — モデルの出力が制約に届かなかったことが画面に出る唯一の場所で、
   * プロンプトの効きを追うのがこの検証環境の目的である。
   *
   * 落ちた分を確定させて持たないのは、職員がその日付を候補日程に足した後も「無い」と
   * 言い続けてしまうため。応答そのものを持って毎回突き合わせ直せば、表示は常に今の
   * 候補日程の一覧と一致する。
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
   * AI が返した日付を候補日程の一覧に当てる。
   *
   * 候補日程に無い日付は書き込まない。書き込むと、後からその日付が候補日程に
   * 足された瞬間に、職員が見ていない○×が現れることになる。
   *
   * **手で付けた○×は上書きしない**（#38 の判断）。ここは特に効く — 職員が手で
   * 付けた可否は本人の予定そのもので、AI が自然文から読み取った推測より確かである。
   * 触らなかった日付は報告に載せ、指示したのに変わらない理由が分かるようにする。
   *
   * 判断を setState の updater の中に置けないのは、何を更新して何を守ったかを
   * **同期で**返す必要があるため（updater は純粋に保つ約束があり、実行も後になる）。
   */
  function applyResult(result: ParseAvailabilityOutput): ApplyReport {
    const known = new Set(dates);
    const next = { ...answers };
    const updated: string[] = [];
    const preserved: string[] = [];

    for (const entry of result.availability) {
      // 落ちた分はここでは数えない。今の候補日程の一覧から導いて別枠で出す（下）。
      if (!known.has(entry.date)) continue;
      const current = next[entry.date];
      // `answers` に入るのは職員か AI が実際に付けた○×だけ（未回答はキーが無い）。
      if (current?.source === "manual") {
        preserved.push(entry.date);
        continue;
      }
      // 同じ○×なら「更新」に数えない。読み取り直した日付を毎回並べると、実際に
      // 変わった日付が埋もれる。
      if (current?.choice === entry.available) continue;
      next[entry.date] = { choice: entry.available, source: "ai" };
      updated.push(entry.date);
    }

    setAnswers(next);
    setLastAnswers(result.availability);
    return { updated, preserved };
  }

  function reset() {
    setAnswers({});
    setLastAnswers([]);
  }

  // 突き合わせに失敗した分。状態として持たず今の候補日程の一覧から導くので、
  // 候補日程タブでその日付が足されればその場で消える。
  const known = new Set(dates);
  const dropped = lastAnswers.filter((entry) => !known.has(entry.date));

  return (
    <div className="mx-auto max-w-3xl">
      <TabHeading>会議ロジ参加可否回答</TabHeading>

      <MeetingInfoHeader info={meetingInfo} />

      <AiAssistant
        taskId={AVAILABILITY_TASK_ID}
        /*
          参加形式・所要時間・候補日程の一覧を与件として送る（ADR-0005 の表）。
          識別子はこの画面が発番したもので、AI は選ぶだけになる。
        */
        input={{
          meeting_format: meetingInfo.format,
          duration_minutes: meetingInfo.durationMinutes,
          candidates: [...candidates],
        }}
        /*
          候補日程が0件のときは送らせない。入力契約が1件以上を要求する（AI が答える
          対象そのものなので）ので、押しても BFF の門で必ず弾かれる。
        */
        submitBlockedReason={
          candidates.length === 0
            ? "候補日程がまだありません。「会議候補日設定」タブで作ると AI に判定させられます。"
            : null
        }
        nonAiPathHint="AI を使わなくても、候補日程ごとに手で○×を付けられます。候補日程がまだ無いときは「会議候補日設定」タブで先に作ってください。"
        description={
          "自然な言葉で出欠を入力すると、AIが自動的に判定します。\n" +
          "例: 「10月15日は出席可能、17日は不可」「火曜は全部出席できます」"
        }
        placeholder="出欠を自然な言葉で入力してください..."
        followUpPlaceholder="16日も参加できるようになりました"
        submitLabel="AIで出欠を判定"
        pendingLabel="判定中..."
        generatingMessage="AIが出欠を判定しています..."
        onResult={applyResult}
        onReset={reset}
      />

      <ManualInputDivider />

      <FormSection taskId={AVAILABILITY_TASK_ID}>
        {dropped.length > 0 && (
          <div
            role="status"
            className="mb-6 rounded-md border-l-4 border-solid-yellow-700 bg-solid-yellow-50 p-3"
          >
            <p className="flex items-center gap-2 text-dns-14M-130 text-solid-yellow-900">
              <Info
                aria-hidden="true"
                className="size-5 shrink-0 text-solid-yellow-800"
              />
              候補日程に無い日付があり、次の回答は反映されませんでした。
            </p>
            <ul className="mt-2 list-disc pl-5 text-dns-14N-130 text-solid-gray-900">
              {dropped.map((entry) => (
                <li key={entry.date}>
                  {entry.date} —{" "}
                  {entry.available ? "○（参加できる）" : "×（参加できない）"}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-dns-14N-130 text-solid-gray-700">
              「会議候補日設定」タブでこの日付を足してからもう一度送るか、AI
              への指示を書き直してください。
            </p>
          </div>
        )}

        {dates.length === 0 ? (
          <p className="text-dns-14N-130 text-solid-gray-700">
            候補日程がまだありません。「会議候補日設定」タブで候補日程を作ると、
            ここに並んで○×を付けられるようになります。
          </p>
        ) : (
          <ul className="grid gap-4">
            {dates.map((date, index) => (
              <li key={date}>
                <AvailabilityFields
                  date={date}
                  index={index}
                  timeRanges={timeRangesOn(candidates, date, meetingInfo)}
                  answer={answers[date] ?? { choice: null, source: "manual" }}
                  onChange={setAnswer}
                />
              </li>
            ))}
          </ul>
        )}
      </FormSection>
    </div>
  );
}

/**
 * その日付の候補日程の時間帯。**終わる時刻は会議の所要時間から導く**（ADR-0005）。
 *
 * 可否を付ける単位は日付なので、同じ日付に候補日程が2つあれば両方を並べる。
 * 片方だけ出すと、職員が見ていない候補日程に可否が付くことになる。
 */
function timeRangesOn(
  candidates: readonly SelectedCandidate[],
  date: string,
  meetingInfo: MeetingInfo,
): string[] {
  return candidates
    .filter((candidate) => candidate.date === date)
    .map((candidate) =>
      candidateRangeText(candidate.start_time, meetingInfo.durationMinutes),
    );
}

type AvailabilityFieldsProps = {
  date: string;
  index: number;
  timeRanges: string[];
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
  timeRanges,
  answer,
  onChange,
}: AvailabilityFieldsProps) {
  // ラジオは1つの候補日程でひとつのグループにする。候補日程をまたいで同じ name に
  // なると、画面全体で1つしか選べなくなる。
  const groupName = useId();

  return (
    <div className="rounded-md border border-solid-gray-300 p-4">
      <div className="flex items-center gap-2">
        <span className="text-dns-14M-130 text-solid-gray-900">
          候補日程 {index + 1}
        </span>
        <span className="text-dns-14N-130 text-solid-gray-700">
          {date} {timeRanges.join(" / ")}
        </span>
      </div>

      <fieldset className="mt-3">
        {/*
          印は候補日程の見出しではなく可否の側に付ける。日付は候補日程タブで職員が
          決めたものなので、全体に付けると「AI が日付も入れた」と読めてしまう。
        */}
        <legend className="flex items-center gap-2 text-dns-12M-130 text-solid-gray-700">
          参加可否
          {answer.source === "ai" && (
            <AiBadge label="AI判定" description="この値はAIが判定しました" />
          )}
        </legend>
        <div className="mt-1 flex gap-4 py-2">
          {CHOICES.map(({ value, choice, label }) => (
            <label
              key={value}
              className="flex items-center gap-2 text-dns-16N-130 text-solid-gray-900"
            >
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
