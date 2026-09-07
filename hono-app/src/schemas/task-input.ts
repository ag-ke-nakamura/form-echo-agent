import type { z } from 'zod'
import { INPUT_SCHEMAS } from './inputs.js'
import { isPromptRequired } from './prompt-requirement.js'
import type { TaskId } from './task-ids.js'

/**
 * 1回分のリクエストが taskId ごとの入力契約を満たすか（ADR-0004）。
 *
 * `prompt` が「書かれたかどうか」の正規化は呼び出し側が行う。BFF は空白だけの
 * 入力を「書かれなかった」として扱うが、それは画面から来る値に対する判断で、
 * この関数の関心事ではない。
 */
export type TaskInputProblem =
  /** 自然文が必須の taskId なのに `prompt` が無い。 */
  | { kind: 'PROMPT_REQUIRED' }
  /** 自然文だけを受け取る taskId に構造化入力が付いていた。 */
  | { kind: 'INPUT_NOT_ACCEPTED' }
  /** 構造化入力が入力契約に適合しない（欠落もここに含む）。 */
  | { kind: 'INPUT_INVALID'; issues: z.core.$ZodIssue[] }

export type TaskInputCheck =
  | { ok: true; input: unknown }
  | { ok: false; problem: TaskInputProblem }

export function checkTaskInput(
  taskId: TaskId,
  request: { prompt?: string | null; input?: unknown },
): TaskInputCheck {
  const { prompt, input } = request

  if (isPromptRequired(taskId) && (prompt === undefined || prompt === null)) {
    return { ok: false, problem: { kind: 'PROMPT_REQUIRED' } }
  }

  const inputSchema = INPUT_SCHEMAS[taskId]
  if (inputSchema === null) {
    // 受け取っても使い道が無い。黙って捨てると、送った側は届いたと思い込む。
    if (input !== undefined && input !== null) {
      return { ok: false, problem: { kind: 'INPUT_NOT_ACCEPTED' } }
    }
    return { ok: true, input: undefined }
  }

  // 構造化入力が必須の taskId では、`input` の欠落もここで弾かれる
  // （`prompt` と `input` の両方が欠けた状態を通さないのはこの経路）。
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      problem: { kind: 'INPUT_INVALID', issues: parsed.error.issues },
    }
  }
  return { ok: true, input: parsed.data }
}
