---
paths:
  - "agent-app/app/FormEchoAgent/**/*.test.ts"
  - "agent-app/app/FormEchoAgent/tests/**/*.ts"
  - "agent-app/app/FormEchoAgent/model/fake.ts"
---

# Runtime のテストの書き方

対象は `agent-app/app/FormEchoAgent`。**何を守り何を守らないかの線引きは #23 の Testing Decisions が正典**で、ここに置くのはそれを実際に踏み外した経験から来る作法だけ。

## シームを増やさない

テストは invocation 境界（#23 のシームその1）だけを叩く。モデルは `FORMECHO_MODEL=fake` で差し替え、返す内容は `model/fake.ts` の `fakeModelScript`（台本）が決める。**テストのために新しい境界を作らない** — 変えるのは設定だけ。

境界の呼び方は `tests/harness.ts`（`invokeBoundary` が `invokeTask` ではなく `handleInvocation` を通す理由もそこにある）。テスト名の一覧は `npm run test:list`。

## モデルが受け取ったものは assert してよい

`fakeModelScript.calls` に残る system prompt と会話履歴を検証してよい。これは内部の呼び出し順ではなく **Runtime が Bedrock へ何を投げたか**であり、Skill の解決と会話履歴の巻き戻しはそこにしか現れない。

## 例外はここに書く（黙って作らない）

境界の外を叩くテストを足したら、**なぜ境界越しに言えないのかをここへ書く。** 書かずに増やすと「シームを増やさない」が有名無実になる。現在の例外は2つ。

## ドメイン部の解決は境界の外から言えない

`taskId` のドメイン部 → ドメインエージェントの解決は `invocation/domain-agent.test.ts` で見る。ドメインエージェントの違いは `Agent` の名前と（第3段の）ツールにしか出ず、モデルへ届く system prompt はタスク部で決まる Skill だから、境界越しの検証は `domainOf` が壊れても通る。

## Web 検索の上限・切り詰め・失敗の切り離しも境界の外から言えない

`tools/web-search.test.ts` は `createWebSearchTool` を直接組んで叩く（#46）。**この3つは
invocation 境界の出力に現れない** — 上限に達したかも、本文を何字で切ったかも、検索が失敗
したかも、`message` と `sources` にはモデルの書いた文としてしか出ないので、境界越しに見ると
「モデルがそう書いたか」を assert することになり、それは #23 が assert しないと決めたものである。

**叩く相手（`WebSearchBackend`）を差し替えるのはテストのためではない。** 実物を選ぶのは
`tools/load.ts` で、`model/load.ts` が `FORMECHO_MODEL` を見て fake を選ぶのと同じ構えになって
いる。違うのは fake の置き場所だけ（モデルは `model/fake.ts` の台本、こちらはテストが渡す関数）
で、**呼び出し側から見た境界は増えていない。**

配線そのもの（交通ICだけが持つ・会議ロジには渡らない）は境界越しにも見えるので、
`handler.test.ts` の「Web 検索（#46）」でも `toolNames` として見ている。

## 契約に適合しない出力は「作り直しに回る」で書く

Strands は Structured Output のツールの検査に落ちた時点でモデルへ作り直しを求めるので、1回の `agent.invoke` の内側で何度でも聞き直す。したがって台本は **`{悪い出力, 良い出力}` の2手**にし、結果が良い出力になり呼び出しが2回になることを見る。

**1手だけ置いて「台本が尽きたら失敗する」を当てにしてはいけない。** 尽きたときの例外は `ModelError` なので、検査しているのは出力契約ではなく台本の枯れ方になる。実際に一度そう書いており、`isRetryable` が `ModelError` を投げ直すようになった時点で9件が落ちた。

## AI の出力品質は assert しない

抽出結果が正しいかは実測の対象。守るのは配線・契約・エラー処理であって、モデルの賢さではない。固定値（`VALID_OUTPUTS`）は `OUTPUT_SCHEMAS` から型を引き、契約から外れた固定値が「弾かれる形」の検証を素通りさせないようにする。
