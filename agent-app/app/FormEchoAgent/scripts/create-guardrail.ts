/**
 * 案B（`ApplyGuardrail`）が参照する Guardrail リソースを新規作成する（#43）。
 *
 * `agentcore.json` の `AgentCoreProjectSpec` に Guardrail を宣言する枠が無い
 * （F-11）ため、リソース作成は `agentcore deploy` の外でこのスクリプトを直接
 * 実行して行う。**既存の2つの Guardrail には触らない**（別の担当者のもので
 * DRAFT のみ）。
 *
 * 実行方法:
 *
 *   npx tsx scripts/create-guardrail.ts
 *
 * 実行後、出力される guardrailId と version を
 * `FORMECHO_GUARDRAIL_ID` / `FORMECHO_GUARDRAIL_VERSION` に設定する
 * （`config.ts` の `resolveGuardrailResource`）。
 *
 * **このスクリプトは自動実行されない。** 実行するとこの AWS アカウントに
 * 実際の Guardrail リソースを作成する（共用アカウント、ap-northeast-1）。
 */
import {
  BedrockClient,
  CreateGuardrailCommand,
  CreateGuardrailVersionCommand,
} from '@aws-sdk/client-bedrock';
import { AWS_REGION } from '../config.js';
import { MY_NUMBER_PATTERN } from '../guardrail/pii.js';

const GUARDRAIL_NAME = 'FormEchoGuardrail';

/**
 * Tier は **Classic** に固定する。Standard Tier はクロスリージョン推論
 * （`crossRegionConfig`）が必須で、ap-northeast-1 発の唯一のプロファイルの
 * 宛先6つのうち4つが国外になり ADR-011 に違反する（F-20）。`crossRegionConfig`
 * は設定しない。
 *
 * しきい値のしきい方は案A（`invoke-checks.ts`）と完全には一致しない —
 * `InvokeGuardrailChecks` は離散スコアを自前のしきい値と比べるのに対し、
 * Guardrail リソースの `filterStrength` / PII の `action` はカテゴリ的な設定で
 * 数値のしきい値を持たない。**両方式が同じ入力に同じ判定を下すかは実測で
 * 確かめる**（このチケットの受け入れ条件の一つ）。ここでの設定は案Aの初期値
 * （F-02・F-06）に近づけた最初の1回分でしかない。
 */
async function main(): Promise<void> {
  const client = new BedrockClient({ region: AWS_REGION });

  const created = await client.send(
    new CreateGuardrailCommand({
      name: GUARDRAIL_NAME,
      description:
        'FormEcho 検証環境の Guardrail（案B）。#43 で作成。既存2つとは別物。',
      contentPolicyConfig: {
        tierConfig: { tierName: 'CLASSIC' },
        filtersConfig: [
          // プロンプトインジェクション・ジェイルブレイク。案Aの
          // promptAttack しきい値 >= 0.8（F-02）に寄せ、ブロックする。
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
        // 汎用 PII（案Aの SENSITIVE_INFORMATION_ENTITIES と同じ顔ぶれ）。
        piiEntitiesConfig: [
          { type: 'EMAIL', action: 'BLOCK' },
          { type: 'PHONE', action: 'BLOCK' },
          { type: 'NAME', action: 'BLOCK' },
          { type: 'ADDRESS', action: 'BLOCK' },
          { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
        ],
        // マイナンバー（F-03・F-16）。コード側の正規表現（`pii.ts`）と同じ
        // パターン文字列を使う — 結果の違いが出るならパターンの解釈の違いに
        // 絞れる。lookaround は使えない（`pii.ts` のコメントの通り、
        // このパターンはそもそも使っていない）。
        regexesConfig: [
          {
            name: 'my_number',
            description: 'マイナンバー（個人番号）12桁',
            pattern: MY_NUMBER_PATTERN,
            action: 'BLOCK',
          },
        ],
      },
      blockedInputMessaging:
        '入力内容に問題があります。個人情報（マイナンバー等）が含まれていないか確認してください。',
      blockedOutputsMessaging:
        '入力内容に問題があります。個人情報（マイナンバー等）が含まれていないか確認してください。',
    }),
  );

  if (created.guardrailId === undefined) {
    throw new Error('CreateGuardrail がガードレールIDを返しませんでした');
  }

  // DRAFT のまま使わず、比較のために固定したバージョンを1つ切る。
  const versioned = await client.send(
    new CreateGuardrailVersionCommand({
      guardrailIdentifier: created.guardrailId,
      description: '#43 の実測比較用の初回バージョン',
    }),
  );

  console.log(
    JSON.stringify(
      {
        guardrailId: created.guardrailId,
        guardrailArn: created.guardrailArn,
        version: versioned.version,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
