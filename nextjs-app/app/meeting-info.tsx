"use client";

import { useId, useState } from "react";
import {
  DURATION_OPTIONS,
  INITIAL_MEETING_INFO,
  MEETING_FORMAT_LABELS,
  MEETING_FORMAT_ORDER,
  type MeetingFormat,
  type MeetingInfo,
  meetingHeadingText,
  meetingSubInfoText,
} from "./lib/meeting-info";

export type MeetingInfoApi = {
  info: MeetingInfo;
  setName: (name: string) => void;
  setDurationMinutes: (durationMinutes: number) => void;
  setFormat: (format: MeetingFormat) => void;
};

/**
 * 会議情報の状態。実体は `FormEchoTabs` が持つ（候補日程と同じ理由 — タブ3・
 * タブ4が読むので、タブ2の内側に置くと相手から見えない）。
 */
export function useMeetingInfo(): MeetingInfoApi {
  const [info, setInfo] = useState<MeetingInfo>(INITIAL_MEETING_INFO);

  return {
    info,
    setName: (name) => setInfo((current) => ({ ...current, name })),
    setDurationMinutes: (durationMinutes) =>
      setInfo((current) => ({ ...current, durationMinutes })),
    setFormat: (format) => setInfo((current) => ({ ...current, format })),
  };
}

/**
 * タブ2の会議情報の入力欄。AI入力アシスタントより**上**に置く。
 *
 * WHY: 所要時間は候補日程の長さを決め、参加形式は参加可否の選択肢を決める。
 * どちらも AI に指示を出す前に決まっていないと、AI が返した候補日程の長さを
 * 後から変えることになる（#64 ストーリー28「先に入力できてほしい」）。
 */
export function MeetingInfoFields({
  meetingInfo,
}: {
  meetingInfo: MeetingInfoApi;
}) {
  const { info, setName, setDurationMinutes, setFormat } = meetingInfo;
  const headingId = useId();
  const nameId = useId();
  const durationId = useId();
  const formatGroupName = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="mb-6 rounded-lg border border-solid-gray-300 p-6"
    >
      {/* AI入力アシスタントと同じ節の重さ。あちらの見出しと同じトークンを使う。 */}
      <h3 id={headingId} className="text-std-20M-150 text-solid-gray-900">
        会議情報
      </h3>
      <p className="mt-2 text-dns-14N-130 text-solid-gray-700">
        所要時間が候補日程の長さを、参加形式が参加可否の選択肢を決めます。
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor={nameId}
            className="text-dns-14M-130 text-solid-gray-900"
          >
            会議名
          </label>
          <input
            id={nameId}
            type="text"
            value={info.name}
            onChange={(event) => setName(event.target.value)}
            placeholder="〇〇会議"
            className="mt-1.5 w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900"
          />
        </div>

        <div>
          <label
            htmlFor={durationId}
            className="text-dns-14M-130 text-solid-gray-900"
          >
            所要時間
          </label>
          <select
            id={durationId}
            value={info.durationMinutes}
            onChange={(event) => setDurationMinutes(Number(event.target.value))}
            className="mt-1.5 w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900"
          >
            {DURATION_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes}分
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-dns-14M-130 text-solid-gray-900">
          参加形式
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-4 py-1">
          {MEETING_FORMAT_ORDER.map((format) => (
            <label
              key={format}
              className="flex items-center gap-2 text-dns-16N-130 text-solid-gray-900"
            >
              <input
                type="radio"
                name={formatGroupName}
                value={format}
                checked={info.format === format}
                onChange={() => setFormat(format)}
              />
              {MEETING_FORMAT_LABELS[format]}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/**
 * タブ3の会議情報ヘッダー（設計書 3節）。
 *
 * タブの見出しと同じ 28B のトークンが会議名にも当たるのは設計書の指定どおりで
 * （「第三階層見出しテンプレート」）、参加者が最初に読むべきものが会議名だという
 * 並びを崩さない。文字列そのものは `lib/meeting-info.ts` が決める。
 */
export function MeetingInfoHeader({ info }: { info: MeetingInfo }) {
  return (
    <div>
      <h3 className="mb-4 text-std-28B-150 text-solid-gray-900">
        {meetingHeadingText(info)}
      </h3>
      <p className="mb-6 text-dns-14N-130 text-solid-gray-700">
        {meetingSubInfoText(info)}
      </p>
    </div>
  );
}
