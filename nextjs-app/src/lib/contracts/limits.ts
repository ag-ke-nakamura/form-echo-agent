/**
 * 入力の長さの上限。#109（ADR-0011）の複製と同じ扱いで、`contracts/api.ts` の
 * `MAX_PROMPT_LENGTH` を nextjs-app 側に持つ。
 *
 * WHY 画面が持つか: `<textarea maxLength>` に渡して**打ち切ってから BFF に弾かれる
 * 事態を先に止める**ため。値として実行時に要るので、zod を import しない
 * `contracts/meeting.ts` と同じ置き方をする。
 */
export const MAX_PROMPT_LENGTH = 10000;
