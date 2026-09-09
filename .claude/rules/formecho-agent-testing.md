---
paths:
  - "agent-app/app/FormEchoAgent/**/*.test.ts"
  - "agent-app/app/FormEchoAgent/tests/**/*.ts"
  - "agent-app/app/FormEchoAgent/model/fake.ts"
  - "agent-app/app/FormEchoAgent/guardrail/fake.ts"
---

# Runtime のテストの書き方

対象は `agent-app/app/FormEchoAgent`。**何を守り何を守らないかの線引きは #23 の Testing Decisions が正典**で、ここに置くのはそれを実際に踏み外した経験から来る作法だけ。

## シームを増やさない

テストは invocation 境界（#23 のシームその1）だけを叩く。モデルは `FORMECHO_MODEL=fake` で差し替え、返す内容は `model/fake.ts` の `fakeModelScript`（台本）が決める。**テストのために新しい境界を作らない** — 変えるのは設定だけ。

境界の呼び方は `tests/harness.ts`（`invokeBoundary` が `invokeTask` ではなく `handleInvocation` を通す理由もそこにある）。テスト名の一覧は `npm run test:list`。

## モデルが受け取ったものは assert してよい

`fakeModelScript.calls` に残る system prompt と会話履歴を検証してよい。これは内部の呼び出し順ではなく **Runtime が Bedrock へ何を投げたか**であり、Skill の解決と会話履歴の巻き戻しはそこにしか現れない。

## Guardrail が検査したものも同じく assert してよい（#170）

`fakeGuardrailScript.calls` に残る「検査を頼まれたテキストと向き」を検証してよい。**新しいシームは作っていない** — モデルの fake が受け取ったものを記録しているのと同じ形で、`FORMECHO_GUARDRAIL_STRATEGY=fake` という既存の設定の差し替え先に記録を足しただけである。

**なぜ記録が要るか: 境界の応答に現れるのはブロックの1ビットだけだから。** 検査対象が黙って消えても・狭まっても、応答は成功のまま何も変わらないのでテストは緑になる。実際にその穴が開いていた — #168 で追加指示が任意になった結果、**フォームだけで生成した回は入力側の検査が1度も走らない**状態が、既存のテストを1つも落とさずに成立した。連結が落ちる（出発地が検査されない）・空の追加指示で検査を省く、といった回帰も同じく1ビットには出ない。

検査対象そのものの判断（どの欄が「人が書いた文」か）は契約側（`contracts/inputs.ts` の `inspectedInputStrings`）にあり、それを `prompt` と連結して1回検査する配線が `invoke-task.ts` にある。どちらも invocation 境界の内側なので、境界越しに確かめる手段はこの記録しかない。

## 例外はここに書く（黙って作らない）

境界の外を叩くテストを足したら、**なぜ境界越しに言えないのかをここへ書く。** 書かずに増やすと「シームを増やさない」が有名無実になる。現在の例外は3つ。

## ドメイン部の解決は境界の外から言えない

`taskId` のドメイン部 → ドメインエージェントの解決は `invocation/domain-agent.test.ts` で見る。ドメインエージェントの違いは `Agent` の名前と（第3段の）ツールにしか出ず、モデルへ届く system prompt はタスク部で決まる Skill だから、境界越しの検証は `domainOf` が壊れても通る。

## Guardrail のしきい値・スコアの解釈も境界の外から言えない（#43）

`guardrail/invoke-checks.test.ts` は、SDK のレスポンスから判定への写像だけを行う純関数
（`verdictFromChecksResults`）を直接叩く。**境界越しに見ると、しきい値が正しく効いているかを
言えない** — invocation 境界の出力に現れるのは `GUARDRAIL_BLOCKED` かどうかの1ビットだけで、
どのスコアがどのしきい値を越えたのかを区別できない。しきい値は `config.ts` の定数
（`GUARDRAIL_THRESHOLDS`、ADR-0013 で env 上書きを畳んだ）なので、テストもその値を前提に置く。
SDK クライアントそのもの（`invokeGuardrailChecks`）は Bedrock を実際に呼ぶ薄い配線で、
`tools/gateway.ts` と同じくテストを持たない。

同じ理由で `guardrail/pii.test.ts`（正規表現がマイナンバー形式を検知するか）と
`guardrail/load.test.ts`（正規表現と `InvokeGuardrailChecks` の判定をどう合成するか）も
`checkJapanesePii` / `checkGuardrail` を直接叩く。合成した後の1ビット（`blocked`）だけでは、
正規表現が効いたのか AWS 側の判定が効いたのかを境界越しに区別できない。

境界越しの配線テスト（ブロックが `GUARDRAIL_BLOCKED` になる・セッションを破棄する・入力側と
出力側の両方で効く）は `invocation/guardrail.test.ts` が見る。`FORMECHO_GUARDRAIL_STRATEGY=fake`
（`guardrail/fake.ts` の `fakeGuardrailScript`）で `InvokeGuardrailChecks` の呼び先を
差し替える — `FORMECHO_MODEL=fake` と同じ考え方で、新しい境界を増やしていない。**これは
テスト専用の設定で、畳んだ案Bのような競合案の切り替えではない。**

## Web 検索の上限・切り詰め・失敗の切り離し・出典番号も境界の外から言えない

`tools/web-search.test.ts` は `createWebSearchTool` を直接組んで叩く（#46・#174）。**この4つは
invocation 境界の出力に現れない** — 上限に達したかも、本文を何字で切ったかも、検索が失敗
したかも、`message` と `sources` にはモデルの書いた文としてしか出ないので、境界越しに見ると
「モデルがそう書いたか」を assert することになり、それは #23 が assert しないと決めたものである。

**叩く相手（`WebSearchBackend`）を差し替えるのはテストのためではない。** 実物を選ぶのは
`tools/load.ts` で、`model/load.ts` が `FORMECHO_MODEL` を見て fake を選ぶのと同じ構えになって
いる。違うのは fake の置き場所だけ（モデルは `model/fake.ts` の台本、こちらはテストが渡す関数）
で、**呼び出し側から見た境界は増えていない。**

**出典番号（`citation_number`。#174・ADR-0019）も同じ。** 番号が何番になるかは、
モデルへ返すツール出力にしか現れない — 境界の出力に出るのは `citations` の並びと、
モデルが選んだ番号だけで、**どちらもモデルの書いたものか、モデルへ渡したものかを
区別できない。** 番号の振り方（リクエスト通し・重複の落とし方）が壊れても、台本が
返す固定の番号はそのまま通る。

**出典の一覧そのもの（`citations`）も同じ**（#202）。境界の出力に出るのは出来上がった一覧
だけで、それが**取得した結果から来ているのか、モデルの申告（`sources`）から来ているのか**を
区別できない。本文を落としているか・重複をどう潰したか・**上限で断った検索のページが載って
いないか**も一覧の見た目には出ない。境界越しに見えるのは欄が在ることだけで、それは
`handler.test.ts` の検証ドメインの回が見ている。

配線そのもの（交通ICだけが持つ・会議ロジには渡らない）は境界越しにも見えるので、
`handler.test.ts` の「Web 検索（#46）」でも `toolNames` として見ている。**取得していない
番号を指した回の warn ログも境界越しに見える**（`handler.test.ts`）。

## 契約に適合しない出力は「作り直しに回る」で書く

Strands は Structured Output のツールの検査に落ちた時点でモデルへ作り直しを求めるので、1回の `agent.invoke` の内側で何度でも聞き直す。したがって台本は **`{悪い出力, 良い出力}` の2手**にし、結果が良い出力になり呼び出しが2回になることを見る。

**1手だけ置いて「台本が尽きたら失敗する」を当てにしてはいけない。** 尽きたときの例外は `ModelError` なので、検査しているのは出力契約ではなく台本の枯れ方になる。実際に一度そう書いており、`isRetryable` が `ModelError` を投げ直すようになった時点で9件が落ちた。

## 壁時計の実行制限は台本に時間を使わせないと見えない（#125）

`FORMECHO_AGENT_LOOP_TIMEOUT_MS` を極端に短くしても、**台本が時間を使わないと `cancelSignal` は
1度も発火しない** — 1手も待たない台本は全体がマイクロタスクで完走するので、タイマーが走る隙が
無く、往復回数の上限（`limits.turns`）の方が先に効く。台本の1手に `delayMs` を付けて
（`model/fake.ts`）モデルが遅い状態を作る。

## AI の出力品質は assert しない

抽出結果が正しいかは実測の対象。守るのは配線・契約・エラー処理であって、モデルの賢さではない。固定値（`VALID_OUTPUTS`）は `OUTPUT_SCHEMAS` から型を引き、契約から外れた固定値が「弾かれる形」の検証を素通りさせないようにする。
