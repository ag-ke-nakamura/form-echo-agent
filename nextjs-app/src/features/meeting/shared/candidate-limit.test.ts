import { describe, expect, it } from "vitest";
import { candidateLimitReason, MAX_INPUT_CANDIDATES } from "./candidate-limit";

/**
 * 上限に達したかの判断（#67）。境界だけを見る。
 *
 * WHY テストを持つか: この判断が緩むと、超えたリクエストが BFF の門で
 * INVALID_INPUT になり、職員は自分の書いた自然文を疑う。逆に厳しすぎると、
 * 契約が受け付ける件数の手前で AI が使えなくなる。どちらも画面を描かないと
 * 気付けない失敗なので、境界を値で押さえる。
 */
describe("candidateLimitReason", () => {
  it("上限ちょうどまでは送れる", () => {
    // 入力契約は `.max(MAX_INPUT_CANDIDATES)` なので、ちょうどは通る。ここを
    // 1件ずらすと、契約が受け付ける件数の手前で AI が使えなくなる。
    expect(candidateLimitReason(0)).toBeNull();
    expect(candidateLimitReason(MAX_INPUT_CANDIDATES)).toBeNull();
  });

  it("上限を超えたら理由を返す", () => {
    expect(candidateLimitReason(MAX_INPUT_CANDIDATES + 1)).toContain(
      String(MAX_INPUT_CANDIDATES),
    );
  });
});
