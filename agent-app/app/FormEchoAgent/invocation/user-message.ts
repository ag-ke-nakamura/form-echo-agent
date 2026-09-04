import type { INPUT_SCHEMAS, TaskId } from '../contracts/index.js';

/**
 * 構造化入力と自然文に付ける見出し。**taskId ごとの表で持つ。**
 *
 * WHY 与件の見出しを taskId ごとにするか: 見出しは「参加可否表」のように中身の名前
 * そのものなので、taskId ごとに違うものを名乗る必要がある。共通の見出し（「入力」など）
 * にすると、モデルの側で何を渡されたのかが読めない。構造化入力を持たない taskId は
 * `null` しか書けないよう型で縛る（`PROMPT_REQUIREMENT` と同じ形）。
 *
 * WHY 自然文の見出しも taskId ごとにするか: **書き手が違う。** 参加可否回答フォームに
 * 自然文を書くのは参加者であって職員ではない（`CONTEXT.md` の用語集はこの2つを
 * 区別している）。全部を「職員からの指示」と名乗ると、`SKILL.md` が参加者に向けて
 * 書いた文言とモデルが受け取る見出しが食い違う。
 */
const HEADINGS = {
  'ic-card.parse-reservation': { input: null, prompt: null },
  'meeting.parse-candidates': {
    input: '会議情報',
    prompt: '職員からの指示',
  },
  'meeting.parse-availability': {
    input: '会議情報と候補日程',
    prompt: '参加者からの回答',
  },
  'meeting.recommend-schedule': {
    input: '会議情報と参加可否表',
    prompt: '職員からの指示',
  },
} satisfies {
  [K in TaskId]: (typeof INPUT_SCHEMAS)[K] extends null
    ? { input: null; prompt: null }
    : { input: string; prompt: string };
};

/**
 * ドメインエージェントへ渡す1ターン分のメッセージを組み立てる。
 *
 * WHY: 構造化入力を `prompt` に埋め込むのはフロントエンドと BFF には禁じられている
 * （ADR-0004。混ぜると入力サニタイズと Guardrail チェックが何を検査しているのか
 * 曖昧になる）。一方でモデルへ渡せるのは結局テキストなので、両者を1本にまとめる
 * 場所はどこかに要る。**検査を全部通した後の Runtime 内側**がその場所になる
 * — ここまで来れば「人が書いた文」と「システムが組み立てた与件」は既に別々に
 * 検査され終わっており、混ざっても検査対象が曖昧にならない。
 *
 * 見出しで2つを隔てるのも同じ理由で、モデルの側でも「与件のデータ」と「人が書いた文」を
 * 取り違えないようにする。
 */
export function buildUserMessage(
  taskId: TaskId,
  prompt: string | null | undefined,
  input: unknown,
): string {
  const headings = HEADINGS[taskId];
  if (headings.input === null) {
    // 交通IC。自然文が必須なのは入力契約の表（PROMPT_REQUIREMENT）が保証している。
    return prompt ?? '';
  }

  const sections = [
    `## ${headings.input}`,
    '',
    'これはシステムが与えた与件です。人が書いた文ではありません。',
    '',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
  ];
  if (prompt) {
    sections.push('', `## ${headings.prompt}`, '', prompt);
  }
  return sections.join('\n');
}
