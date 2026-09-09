import type { FREE_PROMPT_TASK_ID, TaskId } from '../contracts/index.js';

/**
 * 構造化入力と自然文に付ける見出し。**taskId ごとの表で持つ。**
 *
 * WHY 与件の見出しを taskId ごとにするか: 見出しは「参加可否表」のように中身の名前
 * そのものなので、taskId ごとに違うものを名乗る必要がある。共通の見出し（「入力」など）
 * にすると、モデルの側で何を渡されたのかが読めない。
 *
 * **`null` は「見出しを持たない」**、つまり user message を組み立てずに `prompt` を
 * そのまま渡すことを表す。`playground.free-prompt` がこれで（ADR-0020）、あの taskId の
 * `input` に載るのは持ち込みシステムプロンプトなので、与件として user message へ
 * 載せる相手が無い — 載せると職員は自分が書いた文を2回渡されたモデルを見ることになる。
 *
 * **`null` を書けるのはその taskId だけ**、と型で縛る。緩めて「どちらの形でもよい」に
 * すると、交通ICの行を `null` にしても型が通り、**与件の JSON が黙ってモデルへ届かなく
 * なる**（画面のどこにも症状が出ない）。
 *
 * WHY 自然文の見出しも taskId ごとにするか: **書き手が違う。** 参加可否回答フォームに
 * 自然文を書くのは参加者であって職員ではない（`CONTEXT.md` の用語集はこの2つを
 * 区別している）。全部を「職員からの指示」と名乗ると、Skill が参加者に向けて
 * 書いた文言とモデルが受け取る見出しが食い違う。
 */
const HEADINGS = {
  'ic-card.parse-reservation': {
    input: 'フォームの入力内容',
    prompt: '職員からの追加指示',
  },
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
  // 与件の見出しも自然文の見出しも持たない（ADR-0020）。
  'playground.free-prompt': { input: null, prompt: null },
} satisfies {
  [K in TaskId]: K extends typeof FREE_PROMPT_TASK_ID
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
  /*
    見出しを持たない taskId は組み立てそのものを行わず、人が書いた文をそのまま渡す。
    我々が足す文はどれもノイズになる（ADR-0020）。

    `?? ''` に落ちる回は入力契約が先に弾く（`PROMPT_REQUIREMENT` が `'required'`）。
    **空の user message はモデルへ投げてはいけない** — 空の text ブロックを Bedrock の
    Converse が `ValidationException` で弾く。ここは型が `null` を許すぶんの受けである。
  */
  if (headings.input === null) return prompt ?? '';
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
