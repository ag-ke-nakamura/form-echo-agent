import type { CfnGuardrailProps } from 'aws-cdk-lib/aws-bedrock';

export const GUARDRAIL_NAME = 'FormEchoGuardrail';

/**
 * `agent-app/app/FormEchoAgent/guardrail/pii.ts` の `MY_NUMBER_PATTERN` と同じ
 * パターン文字列。値を揃えたのは、コード側の正規表現チェックとこのリソースの
 * `regexesConfig` が同じ入力に同じ判定を下すかを実測で比べるためで、**その比較は
 * #44 で終わっている**（ADR-0013 で案Bを畳んだ）。揃え続ける理由はもう無い —
 * このリソース自体を #126 で消す。
 */
const MY_NUMBER_PATTERN = String.raw`\d{4}-?\d{4}-?\d{4}`;

const BLOCKED_MESSAGE = '入力内容に問題があります。個人情報（マイナンバー等）が含まれていないか確認してください。';

/**
 * 案B（`ApplyGuardrail`）が参照していた Guardrail リソース（Classic Tier、新規名前）の
 * 定義。**案Bを畳んだので読む側はもう居ない**（ADR-0013。削除は #126）。旧
 * `scripts/create-guardrail.ts`（ADR-0010 により廃止）の設定をそのまま移した —
 * 実測データの前提が変わらないよう、しきい値・PII 対象・正規表現は変更していない。
 *
 * Tier は **Classic** に固定する。Standard Tier はクロスリージョン推論が必須で、
 * ap-northeast-1 発の唯一のプロファイルの宛先6つのうち4つが国外になり ADR-011
 * に違反する（F-20）。
 */
export function guardrailProps(): CfnGuardrailProps {
  return {
    name: GUARDRAIL_NAME,
    description:
      'FormEcho 検証環境の Guardrail（案B）。#43 で作成、ADR-0010 により agent-app/infra の CDK 管理下に移行。既存2つとは別物。',
    contentPolicyConfig: {
      contentFiltersTierConfig: { tierName: 'CLASSIC' },
      filtersConfig: [
        // プロンプトインジェクション・ジェイルブレイク。案Aの promptAttack
        // しきい値 >= 0.8（F-02）に寄せ、ブロックする。
        {
          type: 'PROMPT_ATTACK',
          inputStrength: 'HIGH',
          outputStrength: 'NONE',
        },
        /*
          content filters（暴言・ヘイト等）は**記録のみ**にする（F-06）。
          日本語では露骨でない表現のスコアが下がり、ブロックすると誤検知が
          実用に耐えない — 案Aの contentFilter しきい値が既定で null（記録の
          み）なのと同じ判断。action を NONE にすると検知情報は
          assessments に残るが介入しない。
        */
        {
          type: 'HATE',
          inputStrength: 'HIGH',
          outputStrength: 'HIGH',
          inputAction: 'NONE',
          outputAction: 'NONE',
        },
        {
          type: 'INSULTS',
          inputStrength: 'HIGH',
          outputStrength: 'HIGH',
          inputAction: 'NONE',
          outputAction: 'NONE',
        },
        {
          type: 'SEXUAL',
          inputStrength: 'HIGH',
          outputStrength: 'HIGH',
          inputAction: 'NONE',
          outputAction: 'NONE',
        },
        {
          type: 'VIOLENCE',
          inputStrength: 'HIGH',
          outputStrength: 'HIGH',
          inputAction: 'NONE',
          outputAction: 'NONE',
        },
        {
          type: 'MISCONDUCT',
          inputStrength: 'HIGH',
          outputStrength: 'HIGH',
          inputAction: 'NONE',
          outputAction: 'NONE',
        },
      ],
    },
    sensitiveInformationPolicyConfig: {
      /*
        案Aの SENSITIVE_INFORMATION_ENTITIES（invoke-checks.ts）と同じ顔ぶれ。
        EMAIL / PHONE / NAME / ADDRESS は含めない — 日本語でも高い confidence で
        検知できる（F-06）のが逆に仇になり、ic-card.parse-reservation の正常な
        出力（行き先という住所そのもの）まで検知してしまう（実機で確認済み）。
        残すのは、どのタスクの正常な出力にも本来含まれ得ない識別子だけ。
      */
      piiEntitiesConfig: [
        { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
        { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
        { type: 'US_PASSPORT_NUMBER', action: 'BLOCK' },
        { type: 'DRIVER_ID', action: 'BLOCK' },
        { type: 'AWS_ACCESS_KEY', action: 'BLOCK' },
        { type: 'AWS_SECRET_KEY', action: 'BLOCK' },
        { type: 'PASSWORD', action: 'BLOCK' },
        { type: 'PIN', action: 'BLOCK' },
      ],
      // マイナンバー（F-03・F-16）。
      regexesConfig: [
        {
          name: 'my_number',
          description: 'マイナンバー（個人番号）12桁',
          pattern: MY_NUMBER_PATTERN,
          action: 'BLOCK',
        },
      ],
    },
    blockedInputMessaging: BLOCKED_MESSAGE,
    blockedOutputsMessaging: BLOCKED_MESSAGE,
  };
}
