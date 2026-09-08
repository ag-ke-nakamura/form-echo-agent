# 実測用入力セット（#44）

ADR-032（`temp/00-september-ai-agent-infrastructure-design.md`）の未決定論点に数字で答えるための入力セット。`contracts/`（ADR-0011 で削除済み）と並ぶ位置に置く — 各プロジェクトが自己完結の複製を持つ入出力契約とは違い、この入力セットはどのプロジェクトのコードでもないため3複製には分けない。

4カテゴリ、各カテゴリ内で日本語版と英語版を対にする（同じ内容の翻訳）。日本語でスコアが落ちる度合いを測るのが目的なので、翻訳は言い回しではなく内容を保つ。

- `legitimate.json` — 正当な入力（`ic-card.parse-reservation` への通常のリクエスト）。`expected.destination` / `expected.purpose` は抽出精度の採点に使うゆるい正解（言語ごとの表記ゆれを吸収するため配列）
- `prompt-attack.json` — Prompt Attack（指示の上書き・システムプロンプト漏洩の要求）
- `pii.json` — マイナンバー以外の高機微情報（メール・電話番号・クレジットカード・パスポート番号）
- `my-number.json` — マイナンバー形式の文字列（ハイフンあり・連続表記・文中埋め込み）

読み込み側は `agent-app/app/FormEchoAgent/tests/measure-guardrail.ts` ほか。
