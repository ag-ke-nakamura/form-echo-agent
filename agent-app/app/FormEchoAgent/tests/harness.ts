import type { Message } from '@strands-agents/sdk';
import type {
  AiErrorResponse,
  AiTaskSuccessResponse,
} from '../contracts/index.js';
import { handleInvocation } from '../invocation/handler.js';
import type { InvocationLogger } from '../invocation/logger.js';
import { type FakeModelCall, fakeModelScript } from '../model/fake.js';

/**
 * invocation 境界を回すための足場（#23 のシームその1）。
 *
 * ここに置くのは呼び出しの手間を省く道具だけで、判断は持たない。fake モデルの
 * 台本（`model/fake.ts`）と違い、こちらは Runtime に配られない。
 */

/**
 * 何もしないロガー。
 *
 * 境界の内側が残すのは警告と失敗の1本ずつで、どちらも呼び出し側には応答の
 * エラーコードとして返る。ログそのものを検証する項目は無いので、記録は持たない。
 */
export function discardingLogger(): InvocationLogger {
  return { warn: () => {}, error: () => {} };
}

let sessionCount = 0;

/** テストごとに別のセッションにする。Agent のキャッシュを跨いで履歴が交ざらない。 */
export function newSessionId(): string {
  sessionCount += 1;
  return `test-session-${sessionCount}`;
}

/**
 * 境界を1回叩く。`sessionId` を渡さなければ毎回別のセッションになる。
 *
 * `handleInvocation` を通すのは、出力契約のエラーコードへの写像がそこにあるため。
 * 「未知の taskId が適切なエラーになる」は `invokeTask` の側からは言えない。
 */
export function invokeBoundary(
  payload: unknown,
  sessionId: string = newSessionId(),
): Promise<AiTaskSuccessResponse | AiErrorResponse> {
  return handleInvocation(payload, { sessionId, log: discardingLogger() });
}

export function expectSuccess(
  response: AiTaskSuccessResponse | AiErrorResponse,
): AiTaskSuccessResponse {
  if ('error' in response) {
    throw new Error(
      `成功を期待しましたが ${response.error.code} でした: ${response.error.message}`,
    );
  }
  return response;
}

export function expectError(
  response: AiTaskSuccessResponse | AiErrorResponse,
): AiErrorResponse['error'] {
  if (!('error' in response)) {
    throw new Error(
      `失敗を期待しましたが成功しました: ${JSON.stringify(response.result)}`,
    );
  }
  return response.error;
}

/**
 * モデルへ渡った system prompt。文字列以外は組み立てていないので、そこで落とす。
 */
export function systemPromptOf(call: FakeModelCall): string {
  const { systemPrompt } = call;
  if (typeof systemPrompt !== 'string') {
    throw new Error(
      `system prompt が文字列ではありません: ${JSON.stringify(systemPrompt)}`,
    );
  }
  return systemPrompt;
}

/** モデルが受け取った1つのメッセージのテキスト。 */
function textOf(message: Message): string {
  return message.content
    .map((block) => (block.type === 'textBlock' ? block.text : ''))
    .join('');
}

/** モデルへの最後の呼び出し。1回も呼ばれていなければ落とす。 */
export function lastCall(): FakeModelCall {
  const call = fakeModelScript.calls.at(-1);
  if (call === undefined) {
    throw new Error('モデルが1回も呼ばれていません');
  }
  return call;
}

/** モデルが受け取った user メッセージのテキスト。会話履歴を外から見るための窓。 */
export function userMessagesOf(call: FakeModelCall): string[] {
  return call.messages
    .filter((message) => message.role === 'user')
    .map(textOf)
    .filter((text) => text.length > 0);
}
