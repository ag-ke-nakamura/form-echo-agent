"use client";

import type { ParseAvailabilityOutput } from "@contracts/index.js";
import type { Availability } from "@contracts/meeting";
import { AlertCircle } from "lucide-react";
import { useId, useState } from "react";
import { AiAssistant } from "./ai-assistant";
import type { SelectedCandidate } from "./candidates-panel";
import { AiBadge, type ApplyReport } from "./field-source";
import { FormSection } from "./form-section";
import { AVAILABILITY_TASK_ID } from "./lib/api";
import {
  type AvailabilityAnswer,
  type AvailabilityAnswers,
  type AvailabilityChoice,
  applyAvailabilityResult,
  availabilityChoicesFor,
  candidateLabel,
  dateHeadingText,
  groupCandidatesByDate,
  unjudgedCandidates,
} from "./lib/availability-form";
import { candidateLimitReason } from "./lib/candidate-limit";
import { candidateRangeText, type MeetingInfo } from "./lib/meeting-info";
import { MeetingInfoHeader } from "./meeting-info";
import { ManualInputDivider, TabHeading } from "./screen-layout";

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
   *
   * 参加形式はここでは表示だけの値ではない。**参加可否の選択肢を決める**
   * （`CONTEXT.md`「参加形式」）ので、ラジオの組み立てと AI 出力の正規化が引く。
   */
  meetingInfo: MeetingInfo;
};

export function AvailabilityPanel({
  candidates,
  meetingInfo,
}: AvailabilityPanelProps) {
  /**
   * 候補日程の識別子をキーにした回答。
   *
   * WHY 日付ではなく識別子か: クリック単位が候補日程になった結果（#69）、同じ日に
   * 複数の候補日程が普通に発生する。日付で持つと「15日の14時は出られるが16時は無理」
   * を表せず、AI が候補日程ごとに返す判定（#70 の出力契約）を当てる先も無くなる。
   * 識別子は候補日程タブが単調増加で配るので、行を消しても他の行の鍵は動かない。
   */
  const [answers, setAnswers] = useState<AvailabilityAnswers>({});
  /**
   * 直近の AI 応答が判定した候補日程の識別子。まだ一度も答えていなければ `null`。
   *
   * WHY 持つか: 判定できなかった候補日程は出力契約が**要素を持たない**ことで表す
   * （`null` を返させない）。何が判定されなかったかは、返ってきたものの裏側にしか
   * 無いので、応答の側を控えておかないと聞き返しの対象を作れない。
   *
   * 確定した一覧ではなく識別子だけを持ち、表示は毎回いまの候補日程から導く。職員が
   * 候補日程を足し引きしても、聞き返しの一覧が消えた候補日程を指し続けない。
   */
  const [judgedCandidateIds, setJudgedCandidateIds] = useState<string[] | null>(
    null,
  );
  /**
   * 「回答を提出」を押した後か。**押した後に手を入れたら下ろす。**
   *
   * WHY: 永続化も送信APIも無い（#70）ので、完了メッセージが表すのは「この内容で
   * 提出した」という参加者の操作だけである。提出後の編集を反映せずに出し続けると、
   * 画面に見えている回答と完了メッセージが指すものが食い違う。
   */
  const [submitted, setSubmitted] = useState(false);

  const groups = groupCandidatesByDate(candidates);
  const choices = availabilityChoicesFor(meetingInfo.format);

  function setAvailability(id: string, availability: Availability) {
    setSubmitted(false);
    setAnswers((current) => ({
      ...current,
      // 手を入れた時点で印が落ちる（設計書 6.3節）。備考は保つ — 参加可否を
      // 選び直しただけで参加者が書いた事情を消す理由が無い。
      [id]: {
        availability,
        source: "manual",
        note: current[id]?.note ?? "",
        noteSource: current[id]?.noteSource ?? "manual",
      },
    }));
  }

  /**
   * 備考だけを書き換える。**印には触らない**（設計書 6.5節）。
   *
   * 参加可否がまだ無い候補日程には備考を書けない。備考は参加可否に添えるもので
   * （`CONTEXT.md`「備考」）、単独で残ると「何に対する事情なのか」が消える。
   * 画面側でも参加可否を選ぶまで備考欄を無効にしてある。
   */
  function setNote(id: string, note: string) {
    setSubmitted(false);
    setAnswers((current) => {
      const answer = current[id];
      if (answer === undefined) return current;
      return {
        ...current,
        [id]: { ...answer, note, noteSource: "manual" },
      };
    });
  }

  /**
   * AI が返した参加可否をフォームへ写す。**判断は `applyAvailabilityResult` が持つ**
   * （手入力の保護・備考の保護・参加形式への寄せ）。
   *
   * 判断を setState の updater の中に置けないのは、何を更新して何を守ったかを
   * **同期で**返す必要があるため（updater は純粋に保つ約束があり、実行も後になる）。
   */
  function applyResult(result: ParseAvailabilityOutput): ApplyReport {
    const applied = applyAvailabilityResult(answers, result, {
      candidates,
      format: meetingInfo.format,
      durationMinutes: meetingInfo.durationMinutes,
    });

    setSubmitted(false);
    setAnswers(applied.answers);
    setJudgedCandidateIds(applied.judgedCandidateIds);
    return applied.report;
  }

  function reset() {
    setAnswers({});
    setJudgedCandidateIds(null);
    setSubmitted(false);
  }

  /*
    聞き返しの対象（設計書 4.6.3節）。AI が一度も答えていないうちは出さない — 候補日程を
    見に来ただけの参加者に「判定できませんでした」と言うことになる。
  */
  const unjudged =
    judgedCandidateIds === null
      ? []
      : unjudgedCandidates(
          candidates,
          judgedCandidateIds,
          Object.keys(answers),
        );

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
          入力契約を満たさない画面状態では送らせない。押しても BFF の門で必ず
          INVALID_INPUT になり、参加者は自分の書いた自然文を疑うことになる。
          下限（1件以上）はこのタブの事情、上限は契約が持つ。
        */
        submitBlockedReason={
          candidates.length === 0
            ? "候補日程がまだありません。「会議候補日設定」タブで作ると AI に判定させられます。"
            : candidateLimitReason(candidates.length)
        }
        nonAiPathHint="AI を使わなくても、候補日程ごとに手で参加可否を選べます。候補日程がまだ無いときは「会議候補日設定」タブで先に作ってください。"
        description={
          "自然な言葉で参加可否を入力すると、AIが自動的に判定します。\n" +
          "例: 「10月15日は出席可能、17日は不可」「火曜は全部出席できます」"
        }
        placeholder="参加可否を自然な言葉で入力してください..."
        followUpPlaceholder="すみません、15日は欠席でした"
        submitLabel="AIで参加可否を判定"
        pendingLabel="判定中..."
        generatingMessage="AIが参加可否を判定しています..."
        onResult={applyResult}
        onReset={reset}
      />

      <ManualInputDivider label="または、各候補に直接入力" />

      <FormSection taskId={AVAILABILITY_TASK_ID}>
        {unjudged.length > 0 && (
          <UnjudgedNotice
            candidates={unjudged}
            durationMinutes={meetingInfo.durationMinutes}
          />
        )}

        {groups.length === 0 ? (
          <p className="text-dns-14N-130 text-solid-gray-700">
            候補日程がまだありません。「会議候補日設定」タブで候補日程を作ると、
            ここに並んで参加可否を選べるようになります。
          </p>
        ) : (
          <>
            <ul className="grid gap-6">
              {groups.map((group) => (
                <li key={group.date}>
                  <h3 className="text-dns-16M-130 text-solid-gray-900">
                    {dateHeadingText(group.date)}
                  </h3>
                  <ul className="mt-2 grid gap-3">
                    {group.candidates.map((candidate) => (
                      <li key={candidate.id}>
                        <AvailabilityFields
                          candidate={candidate}
                          durationMinutes={meetingInfo.durationMinutes}
                          choices={choices}
                          answer={answers[candidate.id]}
                          onSelect={setAvailability}
                          onNoteChange={setNote}
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <button
                type="button"
                onClick={() => setSubmitted(true)}
                className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white"
              >
                回答を提出
              </button>
              {submitted && (
                <p
                  role="status"
                  className="mt-3 border-l-4 border-solid-blue-700 bg-solid-blue-50 p-3 text-dns-14N-130 text-solid-gray-900"
                >
                  回答を受け付けました。この検証環境では保存されないので、画面を
                  読み込み直すと消えます。
                </p>
              )}
            </div>
          </>
        )}
      </FormSection>
    </div>
  );
}

/**
 * 直近の応答が判定できなかった候補日程（設計書 4.6.1節・4.6.3節）。
 *
 * WHY 画面に出すか: 判定できなかったことは出力契約では**要素の不在**でしか表れない
 * ので、黙っていると参加者にはラジオが空のままの候補日程が残るだけになる。AI が
 * 読み取れなかったのか、そもそも触れなかったのかも区別が付かない。ここに挙げれば
 * そのまま追加の指示に書き写せる。
 */
function UnjudgedNotice({
  candidates,
  durationMinutes,
}: {
  candidates: readonly SelectedCandidate[];
  durationMinutes: number;
}) {
  return (
    <div
      role="status"
      className="mb-6 rounded-md border-l-4 border-solid-yellow-700 bg-solid-yellow-50 p-3"
    >
      <p className="flex items-center gap-2 text-dns-14M-130 text-solid-yellow-900">
        <AlertCircle
          aria-hidden="true"
          className="size-5 shrink-0 text-solid-yellow-800"
        />
        以下の候補日程について、参加可否を教えてください。
      </p>
      <ul className="mt-2 list-disc pl-5 text-dns-14N-130 text-solid-gray-900">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            {candidateLabel(candidate, durationMinutes)} —{" "}
            <span className="text-solid-gray-600">
              （判定できませんでした）
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-dns-14N-130 text-solid-gray-700">
        AI に書き足して送り直すか、下のラジオで直接選んでください。
      </p>
    </div>
  );
}

type AvailabilityFieldsProps = {
  candidate: SelectedCandidate;
  durationMinutes: number;
  choices: readonly AvailabilityChoice[];
  /** 未回答なら `undefined`。ラジオはどれも選ばれない。 */
  answer: AvailabilityAnswer | undefined;
  onSelect: (id: string, availability: Availability) => void;
  onNoteChange: (id: string, note: string) => void;
};

function AvailabilityFields({
  candidate,
  durationMinutes,
  choices,
  answer,
  onSelect,
  onNoteChange,
}: AvailabilityFieldsProps) {
  // ラジオは1つの候補日程でひとつのグループにする。候補日程をまたいで同じ name に
  // なると、画面全体で1つしか選べなくなる。
  const groupName = useId();
  const legendId = useId();
  const noteId = useId();

  return (
    <div className="rounded-md border border-solid-gray-300 p-4">
      {/*
        印は候補日程の時間表示の隣に置く（設計書 6.2節）。日付は候補日程タブで職員が
        決めたものだが、それは日付グループの見出しの側にあるので、この枠に付いた印は
        この候補日程への回答を指す。
      */}
      <div className="flex items-center gap-2">
        <span className="text-dns-14M-130 text-solid-gray-900">
          {candidateRangeText(candidate.start_time, durationMinutes)}
        </span>
        {answer?.source === "ai" && (
          <AiBadge
            label="AI判定"
            description="この参加可否はAIが判定しました"
          />
        )}
      </div>

      <fieldset className="mt-3">
        <legend id={legendId} className="text-dns-12M-130 text-solid-gray-700">
          参加可否
        </legend>
        {/*
          `role="radiogroup"` と `aria-labelledby` は設計書 10.2節の指定。中身は素の
          ラジオなので、矢印キーでの移動は同じ `name` を共有していることで成り立つ
          （JavaScript で組み直さない）。
        */}
        <div
          role="radiogroup"
          aria-labelledby={legendId}
          className="mt-1 flex flex-wrap gap-x-4 gap-y-2 py-2"
        >
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex items-center gap-2 text-dns-16N-130 text-solid-gray-900"
            >
              <input
                type="radio"
                name={groupName}
                value={choice.value}
                checked={answer?.availability === choice.value}
                onChange={() => onSelect(candidate.id, choice.value)}
              />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-2">
        <label
          htmlFor={noteId}
          className="text-dns-12M-130 text-solid-gray-700"
        >
          備考（任意。参加可否を選ぶと書けます）
        </label>
        <textarea
          id={noteId}
          rows={2}
          value={answer?.note ?? ""}
          disabled={answer === undefined}
          onChange={(event) => onNoteChange(candidate.id, event.target.value)}
          placeholder="午前中は別の予定があります"
          className="mt-1 w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900 disabled:bg-solid-gray-50 disabled:text-solid-gray-600"
        />
      </div>
    </div>
  );
}
