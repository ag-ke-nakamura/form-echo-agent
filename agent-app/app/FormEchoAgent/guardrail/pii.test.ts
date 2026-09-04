import { describe, expect, it } from 'vitest';
import { checkJapanesePii } from './pii.js';

/**
 * F-03: `InvokeGuardrailChecks` にマイナンバー相当の型が無いため、実装方式に
 * よらず必要な正規表現チェック（F-16）。
 */
describe('checkJapanesePii', () => {
  it('マイナンバー形式（ハイフン区切り）の文字列をブロックする', async () => {
    const verdict = await checkJapanesePii(
      '私のマイナンバーは1234-5678-9012です',
      'INPUT',
    );

    expect(verdict.blocked).toBe(true);
    expect(verdict.findings).toEqual([
      { checkType: 'sensitiveInformation', detail: 'my_number(regex)' },
    ]);
  });

  it('マイナンバー形式（連続表記）の文字列もブロックする', async () => {
    const verdict = await checkJapanesePii(
      '123456789012が個人番号です',
      'OUTPUT',
    );

    expect(verdict.blocked).toBe(true);
  });

  it('12桁の数字を含まない文字列はブロックしない', async () => {
    const verdict = await checkJapanesePii(
      '来月15日から3泊4日で大阪出張、新幹線で往復',
      'INPUT',
    );

    expect(verdict).toEqual({ blocked: false, findings: [] });
  });
});
