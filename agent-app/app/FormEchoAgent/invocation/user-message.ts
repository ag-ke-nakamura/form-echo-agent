import type { INPUT_SCHEMAS, TaskId } from '../contracts/index.js';

/**
 * 構造化入力を渡すときの見出し。**taskId ごとの表で持つ。**
 *
 * WHY: 見出しは「参加可否表」のように中身の名前そのものなので、構造化入力を持つ
 * taskId が2つ目になった瞬間に、別のデータが参加可否表と名乗ることになる。
 * 構造化入力を持たない taskId は `null` しか書けないよう型で縛る
 * （`PROMPT_REQUIREMENT` と同じ形）。
 */
const INPUT_HEADINGS = {
  'ic-card.parse-reservation': null,
  'meeting.parse-candidates': null,
  'meeting.parse-availability': null,
  'meeting.recommend-schedule': '参加可否表',
} satisfies {
  [K in TaskId]: (typeof INPUT_SCHEMAS)[K] extends null ? null : string;
};

/**
 * ドメインエージェントへ渡す1ターン分のメッセージを組み立てる。
 *
 * WHY: 構造化入力を `prompt` に埋め込むのはフロントエンドと BFF には禁じられている
 * （ADR-0004。混ぜると入力サニタイズと Guardrail チェックが何を検査しているのか
 * 曖昧になる）。一方でモデルへ渡せるのは結局テキストなので、両者を1本にまとめる
 * 場所はどこかに要る。**検査を全部通した後の Runtime 内側**がその場所になる
 * — ここまで来れば「職員が書いた文」と「システムが組み立てた表」は既に別々に
 * 検査され終わっており、混ざっても検査対象が曖昧にならない。
 *
 * 見出しで2つを隔てるのも同じ理由で、モデルの側でも「与件のデータ」と「職員の指示」を
 * 取り違えないようにする。
 */
export function buildUserMessage(
  taskId: TaskId,
  prompt: string | null | undefined,
  input: unknown,
): string {
  const heading = INPUT_HEADINGS[taskId];
  if (heading === null) {
    // 抽出系。自然文が必須なのは入力契約の表（PROMPT_REQUIREMENT）が保証している。
    return prompt ?? '';
  }

  const sections = [
    `## ${heading}`,
    '',
    'これはシステムが与えた与件です。職員が書いた文ではありません。',
    '',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
  ];
  if (prompt) {
    sections.push('', '## 職員からの指示', '', prompt);
  }
  return sections.join('\n');
}
