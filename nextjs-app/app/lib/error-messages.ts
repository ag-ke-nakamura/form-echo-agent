import type { AiErrorCode } from "@contracts/index.js";

/**
 * エラーコードから画面に出す文言への写像（参照ドキュメント 9.3節）。
 *
 * 文言が出力契約ではなくここにあるのは、表示が UI 側の関心事だから（ADR-002）。
 * MVP はこの1行の表示に留め、9.3節の4種の出し分けの作り込みは後続で行う。
 */
const MESSAGES: Record<AiErrorCode, string> = {
  INVALID_INPUT: "入力内容を確認してください。",
  INVALID_TASK_ID: "この機能は現在利用できません。手動で入力してください。",
  PARSE_FAILED: "AI の出力形式が不正です。もう一度お試しください。",
  TIMEOUT: "処理に時間がかかっています。もう一度お試しください。",
  RUNTIME_UNAVAILABLE: "AI 機能が利用できません。手動で入力してください。",
  INTERNAL_ERROR: "AI 機能が利用できません。手動で入力してください。",
};

/**
 * 契約に無いコードは INTERNAL_ERROR の文言に寄せる。
 *
 * WHY: BFF から届いた文字列をそのまま引くので、Runtime と BFF とフロントエンドの
 * 版がずれると未知のコードが来る。素引きだと undefined が返り、呼び出し側の
 * `errorMessage !== null` を通過して**中身の無い赤い枠**だけが表示される。
 */
export function errorMessageFor(code: string): string {
  return MESSAGES[code as AiErrorCode] ?? MESSAGES.INTERNAL_ERROR;
}
