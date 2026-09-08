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

/**
 * 既定は `sonnet`。**コストで `haiku` に倒さないこと。**
 *
 * WHY: #121 の実測では Haiku の方が1リクエストあたり25〜58%安い（トークンは
 * 約2.1倍だが単価差3倍がそれを上回る）。それでも Sonnet を既定にするのは、
 * Haiku が Structured Output を1往復で返せず2往復目に回る率が高い（8観測中5件。
 * Sonnet は8/8 が1往復）ため。`MAX_STRUCTURED_OUTPUT_ATTEMPTS` は2しかないので、
 * スキーマに手こずるモデルは PARSE_FAILED に近い側で動くことになる。
 * 抽出精度自体はこの実測の範囲では差が出ていない（`docs/reference-doc-fixes.md` F-10）。
 */
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
 * Runtime が1リクエストに使える壁時計の既定値（#125）。
 *
 * **BFF の呼び出し側タイムアウト（`hono-app` の `RUNTIME_TIMEOUT_MS`、既定60秒）より
 * 短く保つ。片方だけ変えるとこの関係が崩れる。** BFF が先に諦めると職員には
 * `TIMEOUT` が返るが Runtime は止まらず、AgentCore Runtime の同期タイムアウト
 * （15分。調整不可）まで走り続けて、誰も受け取らない応答のために Bedrock の
 * トークンを消費する。Runtime 側を先に切れば、その経路が塞がる。
 *
 * 2つの別プロジェクトの定数の大小なので、自動テストでは守らない — 片方しか
 * 見えないテストでは関係を検査できない。ここのコメントが唯一の歯止めである。
 */
const DEFAULT_AGENT_LOOP_TIMEOUT_MS = 55_000;

/**
 * `agent.invoke` に渡す `cancelSignal` の期限（ミリ秒）。
 *
 * 名前に `AGENT_LOOP` を入れて BFF 側の `FORMECHO_RUNTIME_TIMEOUT_MS`（呼び出し側が
 * 待つ時間）と紛れないようにする。効くのはエージェントループだけで、Runtime の
 * プロセス全体を止めるものではない。
 *
 * 不正な値はここで落とす。通すと `AbortSignal.timeout(NaN)` が即時に発火して
 * **全リクエストが静かに PARSE_FAILED になる**（職員には「読み取れませんでした」が
 * 出るだけで、設定の誤りだと分からない）。落とせば handler が 500 にし、BFF が
 * RUNTIME_UNAVAILABLE を返すので、設定の誤りとして気付ける。
 *
 * 読むのはリクエストごと（`invokeTask` の入口）で、起動時ではない。
 */
export function resolveAgentLoopTimeoutMs(): number {
  const raw = process.env.FORMECHO_AGENT_LOOP_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_AGENT_LOOP_TIMEOUT_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `FORMECHO_AGENT_LOOP_TIMEOUT_MS は正の数（ミリ秒）にしてください（受け取った値: ${raw}）`,
    );
  }
  return ms;
}

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
 * テストは `InvokeGuardrailChecks`（AWS 呼び出し）を fake に差し替える。
 *
 * 日本固有 PII の正規表現チェック（`pii.ts`）は AWS を呼ばない純関数なので
 * fake 化の対象にしない — 差し替えなくても決定的で、テストでも実物のロジックを
 * そのまま検証できる。
 *
 * **これは実装方式の選択肢ではない。** 経路は `InvokeGuardrailChecks` + 日本固有
 * PII 検知の1本に畳んである（ADR-0013）。`fake` はその呼び先を差し替えるだけの
 * テスト専用の設定。
 */
export function isGuardrailFake(): boolean {
  return (
    process.env.FORMECHO_GUARDRAIL_STRATEGY === FAKE_GUARDRAIL_STRATEGY_NAME
  );
}

/**
 * `InvokeGuardrailChecks` のスコアが取りうる離散値（F-02）。しきい値はこの格子
 * 上からしか選べない — `> 0.8` は `== 1.0` と同義になり、0.8 のスコアを素通し
 * してしまう（実際にあった誤り。参照ドキュメント側の修正メモが F-02）。
 */
type GuardrailScore = 0 | 0.2 | 0.4 | 0.6 | 0.8 | 1;

interface GuardrailThresholds {
  promptAttack: GuardrailScore | null;
  sensitiveInformation: GuardrailScore | null;
  contentFilter: GuardrailScore | null;
}

/**
 * チェック種別ごとのブロックしきい値（F-02・F-06）。`null` はブロックせず記録のみ。
 *
 * 値は #44 の実測で決まっており（`promptAttack` は `>= 0.8`、`sensitiveInformation`
 * は `>= 0.6`）、env で上書きできる形は畳んだ（ADR-0013 — 設定している場所が
 * 計測スクリプト以外に無かった）。`contentFilter` は日本語では露骨でない表現の
 * スコアが下がる（F-06。「あなたみたいな人は尊敬に値しない」が INSULTS 0.20 に
 * しかならない）ため記録のみ — 0.2 まで下げると誤検知が実用に耐えない。
 */
export const GUARDRAIL_THRESHOLDS: GuardrailThresholds = {
  promptAttack: 0.8,
  sensitiveInformation: 0.6,
  contentFilter: null,
};
