import type { ParseReservationOutput } from '../contracts/outputs.js';
import { invokeTask } from '../invocation/invoke-task.js';
import { loadMeasurementInputs } from './measurement-inputs.js';

/**
 * モデル別（Sonnet 4.6 / Haiku 4.5）の抽出精度とトークン使用量を比べる（#44）。
 * **合否判定は持たない** — #23 の Testing Decisions に従い、観測した数字だけを
 * 記録する。`ic-card.parse-reservation` の正当な入力セット（日本語）を両モデルへ
 * 同じ形で通す。
 *
 * 実行:
 *   npx tsx tests/measure-model-comparison.ts
 */

interface PairedInput {
  id: string;
  ja: string;
  en: string;
  expected: { destination: string[]; purpose: string };
}

const LEGITIMATE = loadMeasurementInputs<PairedInput>('legitimate');

const MODELS = ['sonnet', 'haiku'] as const;

interface Observation {
  model: (typeof MODELS)[number];
  id: string;
  destination: string | null;
  purpose: string | null;
  destinationCorrect: boolean;
  purposeCorrect: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** エージェントループの往復回数。入力トークンの差の原因切り分けに使う（#121）。 */
  cycles: number;
  elapsedMs: number;
}

async function run(): Promise<void> {
  const observations: Observation[] = [];

  for (const model of MODELS) {
    process.env.FORMECHO_MODEL = model;
    for (const item of LEGITIMATE) {
      const startedAt = Date.now();
      const invoked = await invokeTask(
        {
          taskId: 'ic-card.parse-reservation',
          prompt: item.ja,
          sessionId: `measure-model-${model}-${item.id}`,
        },
        {
          warn: (context, message) =>
            console.error('[warn]', message, JSON.stringify(context)),
          error: (context, message) =>
            console.error('[error]', message, JSON.stringify(context)),
        },
      );
      const elapsedMs = Date.now() - startedAt;
      const result = invoked.result as ParseReservationOutput;

      observations.push({
        model,
        id: item.id,
        destination: result.destination,
        purpose: result.purpose,
        destinationCorrect:
          result.destination !== null &&
          item.expected.destination.some((expected) =>
            result.destination?.includes(expected),
          ),
        purposeCorrect: result.purpose === item.expected.purpose,
        inputTokens: invoked.usage.inputTokens,
        outputTokens: invoked.usage.outputTokens,
        totalTokens: invoked.usage.totalTokens,
        cycles: invoked.cycles,
        elapsedMs,
      });
    }
  }

  const summary = MODELS.map((model) => {
    const forModel = observations.filter((o) => o.model === model);
    const accuracyOf = (correct: (o: Observation) => boolean) =>
      forModel.filter(correct).length / forModel.length;
    const avg = (values: number[]) =>
      values.reduce((sum, v) => sum + v, 0) / values.length;
    return {
      model,
      destinationAccuracy: accuracyOf((o) => o.destinationCorrect),
      purposeAccuracy: accuracyOf((o) => o.purposeCorrect),
      avgInputTokens: avg(forModel.map((o) => o.inputTokens)),
      avgOutputTokens: avg(forModel.map((o) => o.outputTokens)),
      avgTotalTokens: avg(forModel.map((o) => o.totalTokens)),
      avgCycles: avg(forModel.map((o) => o.cycles)),
      avgElapsedMs: avg(forModel.map((o) => o.elapsedMs)),
    };
  });

  console.log(JSON.stringify({ observations, summary }, null, 2));
}

await run();
