/**
 * Runtime の設定。すべて環境変数から読み、再ビルドせずに切り替えられるようにする。
 */

/**
 * 使えるモデルは `jp.` プレフィックスの推論プロファイルだけに限る。
 *
 * WHY: ap-northeast-1 に ON_DEMAND の現行 Claude は存在せず、推論プロファイルが
 * 必須になる。そのうち `apac.` と `global.` は国外リージョンへ推論を振るため
 * ADR-011（データ主権）に違反する。`jp.` は ap-northeast-1 + ap-northeast-3 に
 * 閉じる（`docs/reference-doc-fixes.md` F-01）。
 */
const BEDROCK_MODEL_IDS = {
  sonnet: 'jp.anthropic.claude-sonnet-4-6',
  haiku: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

/** Bedrock の推論プロファイルを指す名前。ここに fake は含まれない。 */
export type BedrockModelName = keyof typeof BEDROCK_MODEL_IDS;

/**
 * Bedrock に接続しない差し替え（#23 の決定性の確保、#40）。
 *
 * WHY: テストと実測は同じ invocation 境界を通り、違うのは設定だけにする。
 * モデルを差し替えるための新しいシームは作らない — BFF の Runtime クライアント
 * （ローカル / デプロイ済み）と同じく、既にある設定の選択肢を1つ増やす。
 */
export const FAKE_MODEL_NAME = 'fake';

export type ModelName = BedrockModelName | typeof FAKE_MODEL_NAME;

/** ADR-011 によりこの検証環境は ap-northeast-1 に固定する。切り替え口は設けない。 */
export const AWS_REGION = 'ap-northeast-1';

export function resolveModelName(): ModelName {
  const name = process.env.FORMECHO_MODEL ?? 'sonnet';
  if (name === FAKE_MODEL_NAME) return FAKE_MODEL_NAME;
  if (name in BEDROCK_MODEL_IDS) return name as BedrockModelName;
  throw new Error(
    `FORMECHO_MODEL は ${[...Object.keys(BEDROCK_MODEL_IDS), FAKE_MODEL_NAME].join(' / ')} のいずれかにしてください（受け取った値: ${name}）`,
  );
}

export function bedrockModelId(name: BedrockModelName): string {
  return BEDROCK_MODEL_IDS[name];
}
