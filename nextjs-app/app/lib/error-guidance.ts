import type { AiErrorCode } from "@contracts/index.js";

/**
 * 失敗したときに画面へ出す案内（参照ドキュメント 9.3節）。
 *
 * 文言が出力契約ではなくここにあるのは、表示が UI 側の関心事だから（ADR-002）。
 *
 * 1行の文言ではなく3つに割るのは、9.3節の4種が「何が起きたか」だけでなく
 * **次にどうするか**（11節のフォールバック）まで違うため。同じ赤い枠に同じ長さの
 * 一文を出すと、もう一度送れば直るもの（タイムアウト）と、送り直しても直らないもの
 * （Runtime 障害・パース失敗）が見分けられない。
 */
export type ErrorGuidance = {
  /** 何が起きたか。 */
  summary: string;
  /** AI 側で既に自動的に行われた回復の説明。それがある種別だけ持つ。 */
  alreadyAttempted?: string;
  /** 職員が次にできること。 */
  nextStep: string;
  /**
   * 非AI経路への導線を出すか（11.1節・11.3節）。
   *
   * タブごとに違う一文（`AiAssistant` の `nonAiPathHint`）はここには置かない。
   * この表はコードから引くので、どのタブで起きた失敗かを知らない。
   */
  offersNonAiPath: boolean;
};

/**
 * WHY: 「もう一度送信してください」と言えるのは、失敗した指示が入力欄に残って
 * いるから（`AiAssistant` は成功したときだけ入力欄を空にする）。打ち直しを
 * 求めない案内はこの挙動に依存しているので、片方だけ変えると案内が嘘になる。
 */
const PROMPT_KEPT = "書いた指示は入力欄に残っています。";

const FILL_FORM_DIRECTLY = "このタブのフォームに直接入力してください。";

const GUIDANCE: Record<AiErrorCode, ErrorGuidance> = {
  INVALID_INPUT: {
    // 長すぎ・空・形式違いのどれでもこのコードになるので、原因を決め打たない。
    summary: "入力内容を確認してください。",
    nextStep: `${PROMPT_KEPT}書き直して送り直してください。`,
    offersNonAiPath: false,
  },
  INVALID_TASK_ID: {
    // 職員の書き方では直らない（画面と BFF の版がずれている）。再送を勧めない。
    summary: "この機能は現在利用できません。",
    nextStep: FILL_FORM_DIRECTLY,
    offersNonAiPath: true,
  },
  PARSE_FAILED: {
    summary: "AI の出力形式が不正です。",
    /**
     * 自動の作り直しを通り抜けた失敗であることを言う（11.3節）。これが無いと、
     * 職員は同じ指示を何度も送り直すことになる。
     *
     * 「2回リトライ済み」と回数で書かないのは、それが常に真ではないため。
     * Runtime 側の上限（`MAX_STRUCTURED_OUTPUT_ATTEMPTS`）は画面に届かないし、
     * PARSE_FAILED は BFF が出力契約で検査し直して落ちたときにも返る — この経路では
     * Runtime の再試行は1回目で成功しており、作り直しは起きていない。仕組みがあって
     * それを通り抜けたことだけを言えば、どちらの経路でも嘘にならない。
     */
    alreadyAttempted:
      "AI 側には出力を作り直す自動リトライがあり、それを通り抜けたうえでの失敗です。",
    nextStep: `同じ指示を送り直しても同じ結果になることがあります。書き方を変えて送り直すか、${FILL_FORM_DIRECTLY}`,
    offersNonAiPath: true,
  },
  TIMEOUT: {
    // Runtime は生きていて遅いだけなので、非AI経路ではなく再送へ寄せる。
    summary: "処理に時間がかかっています。",
    nextStep: `${PROMPT_KEPT}もう一度送信してください。`,
    offersNonAiPath: false,
  },
  RUNTIME_UNAVAILABLE: {
    summary: "AI 機能が利用できません。",
    nextStep: FILL_FORM_DIRECTLY,
    offersNonAiPath: true,
  },
  INTERNAL_ERROR: {
    // Runtime 障害と同じ案内にする。原因は違うが、職員にできることは同じ。
    // 分けて持つのは、原因が分かって片方の案内だけ変わったときに動かせるようにするため。
    summary: "AI 機能が利用できません。",
    nextStep: FILL_FORM_DIRECTLY,
    offersNonAiPath: true,
  },
};

/**
 * 契約に無いコードは INTERNAL_ERROR の案内に寄せる。
 *
 * WHY: BFF から届いた文字列をそのまま引くので、Runtime と BFF とフロントエンドの
 * 版がずれると未知のコードが来る。素引きだと undefined が返り、呼び出し側の
 * 分岐を通過して**中身の無い赤い枠**だけが表示される。
 */
export function errorGuidanceFor(code: string): ErrorGuidance {
  return GUIDANCE[code as AiErrorCode] ?? GUIDANCE.INTERNAL_ERROR;
}
