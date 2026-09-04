import type { TaskId, WebSearchCitation } from "@contracts/index.js";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Info,
  Loader2,
  Lock,
} from "lucide-react";
import type { ApplyReport } from "./field-source";
import { formSectionId } from "./form-section";
import {
  hasApplicableItems,
  MAX_CONSECUTIVE_FAILURES,
  type PreviewItem,
  previewTone,
} from "./lib/ai-preview";
import { linkableSources } from "./lib/sources";
import type { ErrorGuidance } from "./lib/error-guidance";

/**
 * 生成中の表示（設計書 3.5節）。
 *
 * 文言はタブごとに違う（「AIが候補日程を生成しています...」など）ので受け取る。
 * **折りたたみの内側に置かない** — 生成中に職員がアシスタントを畳むと、読み上げの
 * 対象になったばかりの live region がその場で隠れて、結果が来たことが分からなくなる。
 */
export function AiPendingNotice({
  message,
  onCancel,
}: {
  message: string;
  /**
   * 待つのをやめる（設計書 8節「API呼び出しは AbortController で中断可能」）。
   * 渡さないタブでは中断の操作を出さない。
   */
  onCancel?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-4">
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-dns-16N-130 text-solid-gray-700"
      >
        <Loader2 aria-hidden="true" className="size-5 animate-spin" />
        {message}
      </p>
      {onCancel !== undefined && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-solid-gray-600 bg-white px-3 py-1.5 text-dns-12M-130 text-solid-gray-900"
        >
          中断
        </button>
      )}
    </div>
  );
}

/**
 * 反映が実際にフォームへ何をしたか（#38）。
 *
 * **プレビューとは別のことを言う。** プレビューは押す前に「何が入るか」を、これは
 * 押した後に「何が入ったか」を言う。両者は一致しない — 手入力で守られた欄や、待って
 * いる間に画面から消えた候補日程がある（`ApplyReport` の `preserved` / `dropped`）。
 * `message` でも代われない。あれはモデルが書いた文で、画面が実際に反映したかどうかは
 * 保証しない。
 */
export function ApplyReportView({ report }: { report: ApplyReport }) {
  const dropped = report.dropped ?? [];
  const skipped = report.skipped ?? [];
  if (
    report.updated.length === 0 &&
    report.preserved.length === 0 &&
    dropped.length === 0 &&
    skipped.length === 0
  ) {
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
      {dropped.length > 0 && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-solid-gray-600">当てる先が無く未反映</dt>
          <dd className="text-solid-gray-900">{dropped.join(" / ")}</dd>
        </div>
      )}
      {skipped.length > 0 && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-solid-gray-600">未反映</dt>
          <dd className="text-solid-gray-900">{skipped.join(" / ")}</dd>
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
  exhausted = false,
}: {
  guidance: ErrorGuidance;
  taskId: TaskId;
  nonAiPathHint: string;
  /**
   * 続けて失敗した回数が上限に達したか（設計書 3.7節）。
   *
   * WHY 種別と別に持つか: 案内の表（`error-guidance.ts`）は1回の失敗だけを見て
   * 書かれている。TIMEOUT のように**1回目は再送を勧めるのが正しい**種別があるので、
   * 3回続いたことは種別からは導けない。導線もここで足す — 「もう一度送信して
   * ください」と言い続ける画面から職員が抜けられなくなる。
   */
  exhausted?: boolean;
}) {
  // 上限に達したら、再送を勧める種別でも非AI経路へ導く。
  const offersNonAiPath = guidance.offersNonAiPath || exhausted;

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
      {/*
        非AI経路の一文（`nonAiPathHint`）は**一文だけに添える。** 上限に達したら
        そちらが次の一手なので下の段落へ、それまでは案内の表が導線を出すと言った
        ときだけこの段落へ。両方に出すと同じ文が2回並ぶ。
      */}
      <p className="mt-2 text-dns-14N-130 text-solid-gray-900">
        {guidance.nextStep}
        {!exhausted && guidance.offersNonAiPath && nonAiPathHint}
      </p>
      {exhausted && (
        <p className="mt-2 text-dns-14M-130 text-solid-gray-900">
          続けて{MAX_CONSECUTIVE_FAILURES}
          回失敗しました。手動入力をご利用ください。{nonAiPathHint}
        </p>
      )}
      {offersNonAiPath && (
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

/**
 * AI の結果を反映する前に見せるプレビュー（ADR-0006、設計書 3.6節）。
 *
 * WHY 別立てのコンポーネントか: これが**フォームの状態が変わる唯一の入口**になった。
 * 3タブで中身の意味は違うが（欄・候補日程・参加可否）、並べ方と2つのボタンは同じで、
 * 違えると「押すまで変わらない」という統制の約束がタブごとに違って見える。
 *
 * メッセージの見た目は結果から導く（`previewTone`）。**契約にフラグを足さない** —
 * 埋まっていないのに「埋まった」と申告された応答を画面が信じてしまうため（#65）。
 *
 * 赤（`AiErrorCode`）はここに無い。結果が返らなかった往復には並べるものが無いので、
 * 赤は別立て（`AiErrorNotice`）になる。**前の往復のプレビューは残るので、赤と同時に
 * 出ることはある** — それが見比べながら書き直せるということである。
 */
export function AiPreview({
  items,
  message,
  citations,
  emptyItemText,
  applyLabel,
  onApply,
  onRevise,
}: {
  items: readonly PreviewItem[];
  /** AI が書いた文（出力契約の `message`）。聞き返しもここに入る。 */
  message: string;
  /**
   * Runtime が取得した Web 検索の出典（#46）。**AI の出力ではない。**
   *
   * 表示は AWS の Web Search Tool の「許容される利用方法」が課す義務であり、
   * 出典（タイトル）とリンクの両方を出す。
   *
   * **空配列のときは何も出さない。** Web 検索を持つのは交通ICだけで、そこでも
   * 経路を尋ねられなかった往復では空のまま返る。見出しだけが残ると、職員には
   * 「検索したが根拠が無い」ように見える。
   */
  citations: readonly WebSearchCitation[];
  /** 抽出・判定できなかった行に添える文字列。タブごとに違う。 */
  emptyItemText: string;
  /** 反映のボタンの文言。「この内容でフォームに入力」など、タブごとに違う。 */
  applyLabel: string;
  onApply: () => void;
  onRevise: () => void;
}) {
  const tone = previewTone(items);
  /*
    押しても何も変わらないなら反映を出さない（`hasApplicableItems`）。押させると
    「フォームは変わっていません」と報告してアシスタントが縮むだけで、職員には
    何が起きたのか分からない。「修正」は残す — そこからが次の一手になる。
  */
  const applicable = hasApplicableItems(items);
  const links = linkableSources(citations);

  return (
    <section
      aria-label="AI生成結果プレビュー"
      className="mt-4 rounded-lg border border-solid-blue-500 bg-white p-4"
    >
      {items.length > 0 && (
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item.key}>
              <PreviewRow item={item} emptyItemText={emptyItemText} />
            </li>
          ))}
        </ul>
      )}

      {/*
        `role="status"` は置かない。この節は応答と一緒に**挿入される**ので、中身入りで
        現れた live region を読み上げない支援技術がある。届いたことを伝えるのは
        `AiAssistant` が常設で持つ live region の仕事（設計書 7.2節の指定は生成中
        インジケーターとエラーに対するもので、プレビューには及んでいない）。
      */}
      {tone === "filled" ? (
        <p className="mt-4 border-l-4 border-solid-blue-700 bg-solid-blue-50 p-3 text-dns-14N-130 text-solid-gray-900">
          {message}
        </p>
      ) : (
        <div className="mt-4 flex gap-2 border-l-4 border-solid-yellow-700 bg-solid-yellow-50 p-3">
          <Info
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-solid-yellow-800"
          />
          <p className="text-dns-14N-130 text-solid-gray-900">{message}</p>
        </div>
      )}

      {/*
        Web 検索の出典。**出すのは義務であって装飾ではない**（#46）。AWS の Web
        Search Tool の「許容される利用方法」が、Search Result を使った出力には
        出典（タイトル）とリンクを添えて表示することを求めている。

        並べるのは **Runtime が実際に取得した結果**であって、AI が `sources` に
        書いた URL ではない。モデルの申告漏れで出典が消えないようにするため。
      */}
      {links.length > 0 && (
        <section
          aria-label="AIが参照した検索結果"
          className="mt-3 border-l-4 border-solid-gray-300 bg-solid-gray-50 p-3"
        >
          <p className="text-dns-12N-130 text-solid-gray-600">
            AI が参照した検索結果
          </p>
          <ul className="mt-2 grid gap-2">
            {links.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  /*
                    別タブで開く。反映前のプレビューを見ている最中なので、同じタブで
                    移ると戻ってきたときにこの往復の結果が消えている。
                    `noreferrer` は `noopener` を含むが、両方書くのが慣例。
                  */
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-start gap-1 text-dns-14N-130 text-solid-blue-700 underline underline-offset-2"
                >
                  <span>{source.label}</span>
                  <ExternalLink
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="sr-only">（新しいタブで開きます）</span>
                </a>
                {/*
                  ホスト名と公開日はリンクの外に出す。どこの情報でいつのものかは
                  経路の裏取りの判断材料になるが、リンクの文字列に混ぜると
                  読み上げが1つの長い文になる。
                */}
                <p className="text-dns-12N-130 text-solid-gray-600">
                  {source.host}
                  {source.publishedDate !== undefined &&
                    ` ・ ${source.publishedDate}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        「修正」を先に置く（設計書 3.6.4節「『この内容でフォームに入力』の左隣」）。
        Tab で辿ると修正 → 反映の順になり、**手が滑って先に反映してしまう側が後**に来る。
      */}
      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onRevise}
          className="rounded-md border border-solid-gray-600 bg-white px-4 py-2 text-dns-16M-130 text-solid-gray-900"
        >
          修正
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!applicable}
          className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
        >
          {applyLabel}
        </button>
      </div>
      {!applicable && (
        <p className="mt-2 text-right text-dns-12N-130 text-solid-gray-600">
          反映できる項目がありません。指示を書き足して送り直してください。
        </p>
      )}
    </section>
  );
}

/**
 * 行の見出し。**値の欄を持たない行（候補日程）では区切りの `:` を出さない** — 付けると
 * 「10月15日(木) 14:00–15:00:」で文が終わる。
 */
function labelText(item: PreviewItem): string {
  return item.value === undefined ? item.label : `${item.label}:`;
}

/**
 * プレビューの1行（設計書 3.6.1節）。
 *
 * 3通りある。埋まった行は緑のチェック、埋まらなかった行は黄色の `AlertCircle`、
 * 押しても変わらない行（手入力を守る）は錠。**色だけで分けない** — 記号も添える
 * 文字列も変える。
 */
function PreviewRow({
  item,
  emptyItemText,
}: {
  item: PreviewItem;
  emptyItemText: string;
}) {
  if (item.value === null) {
    return (
      <p className="flex items-center gap-2 text-dns-14N-130 text-solid-gray-600">
        <AlertCircle
          aria-hidden="true"
          className="size-5 shrink-0 text-solid-yellow-700"
        />
        <span className="text-solid-gray-700">{item.label}:</span>
        {emptyItemText}
      </p>
    );
  }

  /*
    AI は読み取れているが反映しても入らない行。`value` は出す — 何を読み取ったのかは
    見せたほうが、手で入れた値を残すか消して AI に任せるかを選べる。
  */
  if (item.preserved === true) {
    return (
      <p className="flex items-center gap-2 text-dns-14N-130 text-solid-gray-600">
        <Lock aria-hidden="true" className="size-5 shrink-0" />
        <span className="text-solid-gray-700">{labelText(item)}</span>
        {item.value}
        <span>（{item.preservedReason ?? "手入力のため変更しません"}）</span>
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2">
      <Check aria-hidden="true" className="size-5 shrink-0 text-success-1" />
      <span className="text-dns-14M-130 text-solid-gray-700">
        {labelText(item)}
      </span>
      {item.value !== undefined && (
        <span className="text-dns-16N-130 text-solid-gray-900">
          {item.value}
        </span>
      )}
    </p>
  );
}
