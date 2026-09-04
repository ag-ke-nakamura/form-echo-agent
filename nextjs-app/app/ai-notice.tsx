import type { TaskId } from "@contracts/index.js";
import { AlertCircle, Loader2 } from "lucide-react";
import type { ApplyReport } from "./field-source";
import { formSectionId } from "./form-section";
import type { ErrorGuidance } from "./lib/error-guidance";

/**
 * 生成中の表示（設計書 3.5節）。
 *
 * 文言はタブごとに違う（「AIが候補日程を生成しています...」など）ので受け取る。
 * **折りたたみの内側に置かない** — 生成中に職員がアシスタントを畳むと、読み上げの
 * 対象になったばかりの live region がその場で隠れて、結果が来たことが分からなくなる。
 */
export function AiPendingNotice({ message }: { message: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 py-4 text-dns-16N-130 text-solid-gray-700"
    >
      <Loader2 aria-hidden="true" className="size-5 animate-spin" />
      {message}
    </p>
  );
}

/**
 * 再生成が実際にフォームへ何をしたか（#38）。
 *
 * `message` の隣に別立てで出す。`message` はモデルが書いた文なので、そこに書かれた
 * 項目が実際にフォームへ入ったとは限らない（手入力で守られた欄、候補日程に無い日付）。
 * こちらは画面が実際にやったことだけを言う。**`message` では代われない。**
 */
export function ApplyReportView({ report }: { report: ApplyReport }) {
  if (report.updated.length === 0 && report.preserved.length === 0) {
    return (
      <p className="mt-3 text-dns-12N-130 text-solid-gray-600">
        フォームは変わっていません。
      </p>
    );
  }
  return (
    <dl className="mt-3 grid gap-1 text-dns-12N-130">
      {report.updated.length > 0 && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-solid-gray-600">更新</dt>
          <dd className="text-solid-gray-900">{report.updated.join(" / ")}</dd>
        </div>
      )}
      {report.preserved.length > 0 && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-solid-gray-600">手入力のため保持</dt>
          <dd className="text-solid-gray-900">
            {report.preserved.join(" / ")}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * 失敗の表示（参照ドキュメント 9.3節、設計書 3.7節）。
 *
 * 起きたことと次の一手を分けて出す。統制のコントローラビリティは「AI が失敗した
 * ことが分かる」だけでは足りず、**その場から非AI経路へ抜けられる**ところまでで
 * 成り立つ（PO ストーリー41）。
 *
 * 導線をリンクで出すのは、「下のフォーム」と書いて済ませられないため。AI が使えないと
 * 分かった直後の職員に**どこへ行けば手で埋められるのか**を探させることになる。
 *
 * `aria-live="assertive"` を `role="alert"` と併記するのは設計書 7.2節の指定どおり。
 * 通信の失敗は職員が今まさに待っている操作の結果なので、読み上げを割り込ませる。
 */
export function AiErrorNotice({
  guidance,
  taskId,
  nonAiPathHint,
}: {
  guidance: ErrorGuidance;
  taskId: TaskId;
  nonAiPathHint: string;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border border-error-1 bg-error-bg p-4"
    >
      <p className="flex items-center gap-2 text-dns-14M-130 text-error-1">
        <AlertCircle aria-hidden="true" className="size-5 shrink-0" />
        {guidance.summary}
      </p>
      {guidance.alreadyAttempted && (
        <p className="mt-1 text-dns-12N-130 text-solid-gray-700">
          {guidance.alreadyAttempted}
        </p>
      )}
      <p className="mt-2 text-dns-14N-130 text-solid-gray-900">
        {guidance.nextStep}
        {guidance.offersNonAiPath && nonAiPathHint}
      </p>
      {guidance.offersNonAiPath && (
        <a
          href={`#${formSectionId(taskId)}`}
          className="mt-3 inline-block rounded-md border border-solid-gray-600 bg-white px-3 py-1.5 text-dns-12M-130 text-solid-gray-900"
        >
          AI を使わずに入力する
        </a>
      )}
    </div>
  );
}
