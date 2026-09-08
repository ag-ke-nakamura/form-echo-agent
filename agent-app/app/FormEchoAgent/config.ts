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
 * Skill の選び方（#42）。
 *
 * - `explicit` — `taskId` が Skill を一意に決め、その instructions を system prompt に
 *   直接注入する（共通設計方針書 14.2節）
 * - `auto` — ドメインエージェントが `AgentSkills` の progressive disclosure で選ぶ
 *   （ADR-032 論点4）。会議ロジは3 Skill を持つので、`taskId` と一致しない Skill を
 *   選ぶ余地がある — その的中率を実測するのは #44
 *
 * 両モードとも同じ Skill データ（`skills/registry.ts`）を読む。domain-agent.ts /
 * system-prompt.ts を参照。
 */
export type SkillSelectionMode = 'explicit' | 'auto';

export function resolveSkillSelectionMode(): SkillSelectionMode {
  const mode = process.env.FORMECHO_SKILL_SELECTION_MODE ?? 'explicit';
  if (mode === 'explicit' || mode === 'auto') return mode;
  throw new Error(
    `FORMECHO_SKILL_SELECTION_MODE は explicit / auto のいずれかにしてください（受け取った値: ${mode}）`,
  );
}

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

/** Bedrock に接続しないブロック判定（テスト用）。`FAKE_MODEL_NAME` と同じ考え方。 */
export const FAKE_GUARDRAIL_STRATEGY_NAME = 'fake';

/**
 * テストは実際の AWS 呼び出し（案A・案B）を fake に差し替える。
 *
 * 日本固有 PII の正規表現チェック（`pii.ts`）は AWS を呼ばない純関数なので
 * fake 化の対象にしない — 差し替えなくても決定的で、テストでも実物のロジックを
 * そのまま検証できる。
 *
 * **「案C」と呼ばない。** チケット #43 は `BedrockModel` の `guardrailConfig`
 * （不採用）を案Cと呼んでいる。この正規表現チェックはそれとは別物で、A/B のような
 * 実装方式の選択肢ではなく、A/B のどちらを選んでも必要になる補助的なチェック
 * （F-03・F-16）。
 */
export function isGuardrailFake(): boolean {
  return (
    process.env.FORMECHO_GUARDRAIL_STRATEGY === FAKE_GUARDRAIL_STRATEGY_NAME
  );
}

function resolveGuardrailFlag(envName: string, fallback: boolean): boolean {
  const raw = process.env[envName];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(
    `${envName} は true / false にしてください（受け取った値: ${raw}）`,
  );
}

export interface GuardrailLayers {
  /** 案A（`InvokeGuardrailChecks`）。リソース不要なので既定 ON。 */
  invokeChecks: boolean;
  /** 案B（`ApplyGuardrail`）。Guardrail リソースが要るので既定 OFF。 */
  applyGuardrail: boolean;
  /** 日本固有 PII のカスタム正規表現（マイナンバー）。既定 ON。 */
  customRegex: boolean;
}

/**
 * 案A・案B・正規表現チェックをそれぞれ独立に ON/OFF できるようにする（#43）。
 *
 * ADR-032「入力検証方式の選択」の実測の土台がこのチケットで、決めるのは
 * 別チケット。3つを1つの排他的な選択にすると、「案Aだけ／案Bだけでマイナンバーを
 * 検知できるか」を試せない — 正規表現チェックが常時 ON だと、案Aと案Bのどちらを
 * 選んでも結果がそちらに覆い隠される。組み合わせて有効化できることで、この
 * 切り分けが設定だけでできる。
 */
export function resolveGuardrailLayers(): GuardrailLayers {
  return {
    invokeChecks: resolveGuardrailFlag(
      'FORMECHO_GUARDRAIL_INVOKE_CHECKS',
      true,
    ),
    applyGuardrail: resolveGuardrailFlag(
      'FORMECHO_GUARDRAIL_APPLY_GUARDRAIL',
      false,
    ),
    customRegex: resolveGuardrailFlag('FORMECHO_GUARDRAIL_CUSTOM_REGEX', true),
  };
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
 * スクリプトで作った後にここへ設定する。案B（`applyGuardrail`）を ON にしたときだけ読む。
 */
export function resolveGuardrailResource(): GuardrailResource {
  const identifier = process.env.FORMECHO_GUARDRAIL_ID;
  const version = process.env.FORMECHO_GUARDRAIL_VERSION;
  if (identifier === undefined || version === undefined) {
    throw new Error(
      '案B（FORMECHO_GUARDRAIL_APPLY_GUARDRAIL=true）には FORMECHO_GUARDRAIL_ID と FORMECHO_GUARDRAIL_VERSION の両方が必要です（agent-app/infra の CDK スタックがデプロイ出力として返す）。',
    );
  }
  return { identifier, version };
}
