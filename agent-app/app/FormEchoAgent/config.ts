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
const MODEL_IDS = {
  sonnet: 'jp.anthropic.claude-sonnet-4-6',
  haiku: 'jp.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

export type ModelName = keyof typeof MODEL_IDS;

/** ADR-011 によりこの検証環境は ap-northeast-1 に固定する。切り替え口は設けない。 */
export const AWS_REGION = 'ap-northeast-1';

export function resolveModelId(): string {
  const name = process.env.FORMECHO_MODEL ?? 'sonnet';
  if (!(name in MODEL_IDS)) {
    throw new Error(
      `FORMECHO_MODEL は ${Object.keys(MODEL_IDS).join(' / ')} のいずれかにしてください（受け取った値: ${name}）`,
    );
  }
  return MODEL_IDS[name as ModelName];
}
