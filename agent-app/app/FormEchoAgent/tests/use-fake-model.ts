import { beforeEach } from 'vitest';
import { FAKE_MODEL_NAME } from '../config.js';
import { fakeModelScript } from '../model/fake.js';

/**
 * テストは必ず fake モデルで回す（#23 の決定性の確保）。
 *
 * WHY: 開発機の `FORMECHO_MODEL` を尊重せず上書きする。尊重すると、その環境変数を
 * 立てた端末でだけテストが Bedrock を叩き、遅く・高価で・不安定になる。
 * 実物に繋ぐのは実測の役目であり、そちらは設定を明示して別に走らせる。
 */
process.env.FORMECHO_MODEL = FAKE_MODEL_NAME;

// 台本と記録はモジュール変数なので、テストを跨いで持ち越さない。
beforeEach(() => {
  fakeModelScript.reset();
});
