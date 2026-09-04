// 値として引くのは `meeting.ts` だけ（zod を持たないので SSG のバンドルに乗らない）。
import { MAX_INPUT_CANDIDATES } from "@contracts/meeting";

export { MAX_INPUT_CANDIDATES };

/**
 * その件数の候補日程を Runtime へ渡せるか。渡せないなら職員に出す理由を返す。
 *
 * WHY 画面が持つか: 上限を超えたリクエストは BFF の門が INVALID_INPUT で弾くが、
 * 職員から見ると**自分が書いた自然文が悪かった**ように読める（画面のどこにも
 * 「多すぎる」とは出ない）。押す前に理由を出すほうが短い。
 *
 * WHY `app/lib` か: 候補日程を足す側（タブ2の「候補日程を追加」）と、それを与件として
 * 送る側（タブ3のAI入力アシスタント）の2箇所が同じ判断を要る。片方に書くと、もう片方が
 * 上限を知らないまま素通りさせる。文言も含めて1箇所に置き、テストで押さえる。
 *
 * 訊いているのは「**その件数を送れるか**」であって「上限に達したか」ではない。足す側は
 * 足した後の件数（`rows.length + 1`）を渡す。この向きにしておくと、AI の反映のように
 * 一度に複数増える経路でも同じ関数がそのまま使える。
 */
export function candidateLimitReason(count: number): string | null {
  if (count <= MAX_INPUT_CANDIDATES) return null;
  return `候補日程は${MAX_INPUT_CANDIDATES}件までです。減らすと AI に渡せます。`;
}
