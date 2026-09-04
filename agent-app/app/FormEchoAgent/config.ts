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

/**
 * 1リクエストあたりの Web 検索の上限（共通設計方針書 7.1節）。
 *
 * 従量課金なので、断る判断はモデルではなくこちら側に置く。数える場所は
 * `tools/web-search.ts`。
 */
export const WEB_SEARCH_MAX_CALLS = 3;

/**
 * Web 検索を提供する AgentCore Gateway の MCP エンドポイント（#46）。
 *
 * **未設定なら Web 検索を持たない。** 実測は Websearch 有効／無効の同じ入力セットを
 * 比べるので、切り替え口が要る（差し替えるのは設定だけ、という `FORMECHO_MODEL` と
 * 同じ形にしてある）。
 *
 * ADR-011 によりリージョンは `AWS_REGION` に固定する。Gateway の URL はホスト名に
 * リージョンを含むので、ここで検査して取り違えを起動時に落とす — 通してしまうと、
 * 検索クエリと結果が国外リージョンへ出たことに気付けない。
 */
export function resolveWebSearchGatewayUrl(): string | null {
  const url = process.env.FORMECHO_WEB_SEARCH_GATEWAY_URL?.trim();
  if (url === undefined || url === '') return null;
  // URL として読めない場合も自分で言う。`new URL` の素の TypeError（Invalid URL）は
  // どの環境変数の話なのかを伝えないので、リージョン違いと同じ言い方に揃える。
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(
      `FORMECHO_WEB_SEARCH_GATEWAY_URL が URL として読めません（受け取った値: ${url}）`,
    );
  }
  if (!hostname.endsWith(`.${AWS_REGION}.amazonaws.com`)) {
    throw new Error(
      `FORMECHO_WEB_SEARCH_GATEWAY_URL は ${AWS_REGION} の Gateway にしてください（受け取った値: ${url}）`,
    );
  }
  return url;
}

/**
 * Guardrail の実装方式（#43）。設定を変えるだけで切り替えられるようにする —
 * ADR-032「入力検証方式の選択」の実測の土台がこのチケットで、決めるのは別チケット。
 *
 * - `invoke-checks` = 案A（`InvokeGuardrailChecks`）。リソース不要、離散スコアを
 *   自前のしきい値と比べる。
 * - `apply-guardrail` = 案B（`ApplyGuardrail`）。Guardrail リソースを参照し、
 *   AWS 側が判定する。
 */
const GUARDRAIL_STRATEGIES = ['invoke-checks', 'apply-guardrail'] as const;
export type GuardrailStrategyName = (typeof GUARDRAIL_STRATEGIES)[number];

/** Bedrock に接続しないブロック判定（テスト用）。`FAKE_MODEL_NAME` と同じ考え方。 */
export const FAKE_GUARDRAIL_STRATEGY_NAME = 'fake';

export function resolveGuardrailStrategy():
  | GuardrailStrategyName
  | typeof FAKE_GUARDRAIL_STRATEGY_NAME {
  const name = process.env.FORMECHO_GUARDRAIL_STRATEGY ?? 'invoke-checks';
  if (name === FAKE_GUARDRAIL_STRATEGY_NAME) return name;
  if ((GUARDRAIL_STRATEGIES as readonly string[]).includes(name)) {
    return name as GuardrailStrategyName;
  }
  throw new Error(
    `FORMECHO_GUARDRAIL_STRATEGY は ${[...GUARDRAIL_STRATEGIES, FAKE_GUARDRAIL_STRATEGY_NAME].join(' / ')} のいずれかにしてください（受け取った値: ${name}）`,
  );
}

/**
 * `InvokeGuardrailChecks` のスコアが取りうる離散値（F-02）。しきい値はこの格子
 * 上からしか選べない — `> 0.8` は `== 1.0` と同義になり、0.8 のスコアを素通し
 * してしまう（実際にあった誤り。参照ドキュメント側の修正メモが F-02）。
 */
const GUARDRAIL_SCORE_GRID = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
type GuardrailScore = (typeof GUARDRAIL_SCORE_GRID)[number];

function resolveGuardrailThreshold(
  envName: string,
  fallback: GuardrailScore | null,
): GuardrailScore | null {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  // ブロックしない設定を明示できるようにする（既定の contentFilter がこれ）。
  if (raw === 'off') return null;
  const value = Number(raw);
  if (!(GUARDRAIL_SCORE_GRID as readonly number[]).includes(value)) {
    throw new Error(
      `${envName} は ${GUARDRAIL_SCORE_GRID.join(' / ')} のいずれか、またはブロックしない設定を表す "off" にしてください（受け取った値: ${raw}）`,
    );
  }
  return value as GuardrailScore;
}

export interface GuardrailThresholds {
  promptAttack: GuardrailScore | null;
  sensitiveInformation: GuardrailScore | null;
  contentFilter: GuardrailScore | null;
}

/**
 * チェック種別ごとのブロックしきい値（F-02・F-06）。`null` はブロックせず記録のみ。
 *
 * 初期値: `promptAttack` は `>= 0.8`。`sensitiveInformation` は `>= 0.6`。
 * `contentFilter` は日本語では露骨でない表現のスコアが下がる（F-06。「あなたみたいな
 * 人は尊敬に値しない」が INSULTS 0.20 にしかならない）ため、既定ではブロックしない
 * — 0.2 まで下げると誤検知が実用に耐えない。
 */
export function resolveGuardrailThresholds(): GuardrailThresholds {
  return {
    promptAttack: resolveGuardrailThreshold(
      'FORMECHO_GUARDRAIL_THRESHOLD_PROMPT_ATTACK',
      0.8,
    ),
    sensitiveInformation: resolveGuardrailThreshold(
      'FORMECHO_GUARDRAIL_THRESHOLD_SENSITIVE_INFO',
      0.6,
    ),
    contentFilter: resolveGuardrailThreshold(
      'FORMECHO_GUARDRAIL_THRESHOLD_CONTENT_FILTER',
      null,
    ),
  };
}

/** 案B（`ApplyGuardrail`）が参照する Guardrail リソース。新規作成分のみ（既存2つには触らない）。 */
export interface GuardrailResource {
  identifier: string;
  version: string;
}

/**
 * `agentcore.json` に Guardrail を宣言する枠が無い（F-11）ため、リソースの識別子は
 * スクリプトで作った後にここへ設定する。`apply-guardrail` 方式を選んだときだけ読む。
 */
export function resolveGuardrailResource(): GuardrailResource {
  const identifier = process.env.FORMECHO_GUARDRAIL_ID;
  const version = process.env.FORMECHO_GUARDRAIL_VERSION;
  if (identifier === undefined || version === undefined) {
    throw new Error(
      'apply-guardrail 方式には FORMECHO_GUARDRAIL_ID と FORMECHO_GUARDRAIL_VERSION の両方が必要です（agent-app/scripts/create-guardrail.ts で作成する）。',
    );
  }
  return { identifier, version };
}
