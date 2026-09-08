import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `measurement-inputs/`（#44）を読む。`contracts/`（ADR-0011 で削除済み）と並ぶ
 * 位置に置いた、日本語版と英語版を対にした実測用入力セット。
 */
const INPUTS_DIR = fileURLToPath(
  new URL('../../../../measurement-inputs/', import.meta.url),
);

export function loadMeasurementInputs<T>(category: string): T[] {
  return JSON.parse(readFileSync(`${INPUTS_DIR}${category}.json`, 'utf8'));
}
