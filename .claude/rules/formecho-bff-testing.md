---
paths:
  - "hono-app/**/*.test.ts"
  - "hono-app/tests/**/*.ts"
  - "hono-app/src/lib/fake-runtime.ts"
  - "hono-app/src/lib/runtime-transport.ts"
---

# BFF のテストの書き方

対象は `hono-app`。**何を守り何を守らないかの線引きは #23 の Testing Decisions が正典**で、ここに置くのはそれを実際に踏み外した経験から来る作法だけ。Runtime 側の作法は `.claude/rules/formecho-agent-testing.md` にある。

## シームを増やさない

テストは HTTP 境界（#23 のシームその2）だけを叩く。Hono の `app.request()` でプロセスを立てずに呼べる（`tests/harness.ts`）。Runtime は `FORMECHO_RUNTIME_CLIENT=fake` で差し替え、返す内容は `src/lib/fake-runtime.ts` の `fakeRuntimeScript`（台本）が決める。**テストのために新しい境界を作らない** — 変えるのは設定だけ。

## fake が差し替えるのは通信だけ

差し替えの境界は `RuntimeTransport`（Runtime へ1回投げて `Response` を受け取るだけの層）に置いてある。**`invokeRuntime` ごと差し替えてはいけない。** エラーコードへの写像も出力契約の再検査もそこにあるので、丸ごと fake にすると「Runtime のタイムアウトが TIMEOUT になる」「契約に反する出力を通さない」といったテストが fake 自身を検証するだけになり、実物と共有しているコードが1行も通らない。

同じ理由で、fake が決めてよいのは**何が起きたか**（応答・タイムアウト・接続失敗）までで、**それがどのエラーコードになるか**は決めない。

## 台本は尽きたら例外にする

`fakeRuntimeScript` は積んだ手を1回ずつ消費し、尽きたら投げる。同じ手を返し続けると、想定より多い呼び出しが表に出ない。

## 固定値は契約から型を引く

`VALID_RESULTS` は `OUTPUT_SCHEMAS` から型を引く（`satisfies { [K in TaskId]: z.infer<...> }`）。固定値がいつのまにか契約から外れていると、「弾かれる形」の検証が全部通ってしまい何も守らなくなる。

## AI の出力品質は assert しない

Runtime が返した `result` が正しいかは実測の対象。ここで守るのは入力の門・エラーの写像・出力契約の再検査であって、モデルの賢さではない。
