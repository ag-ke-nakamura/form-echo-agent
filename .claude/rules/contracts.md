---
paths:
  - "agent-app/app/FormEchoAgent/contracts/**/*"
  - "agent-app/app/FormEchoAgent/invocation/**/*"
  - "hono-app/src/schemas/**/*"
  - "hono-app/src/lib/**/*"
  - "nextjs-app/app/lib/**/*"
---

# 入出力契約

出力スキーマ（Zod）・リクエスト型・エラーコード・`taskId` 許可リストの定義。**共有ディレクトリは
無く、`agent-app/app/FormEchoAgent/contracts/`・`hono-app/src/schemas/`・
`nextjs-app/app/lib/contracts/` にそれぞれ自己完結の複製として存在する**（ADR-0011）。

**ただし応答封筒と `AiErrorCode` は例外で、`nextjs-app` は複製を持たない**（ADR-0015）。
`nextjs-app/app/lib/api.ts` が `hono-app` の `AppType` から `InferResponseType` で導出しており、
BFF が封筒の欄やエラーコードを変えると `nextjs-app` の型検査が落ちる。**この2つを
`nextjs-app/app/lib/contracts/types.ts` へ書き戻さないこと** — 書き戻すとドリフト検知が消える。
`AppType` 越しに届く `result` は `unknown` で、出力契約と `TaskId` の複製は3プロジェクトに
残っている。**`hono` のバージョンは両プロジェクトで揃える**（ずれると "Type instantiation is
excessively deep and possibly infinite" になる）。
複製元は同じなので現状は内容が一致しているが、3者間のドリフトを検知する自動テストは無い
（意図的。ADR-0011）。以下は3プロジェクトに共通する判断内容の説明で、実体は複製先ごとに別のコード。

## 判断は契約側の関数に置く

`checkTaskInput(taskId, {prompt, input})` が「このリクエストが入力契約を満たすか」を、
`outputSchemaFor(taskId, input)` が「この応答を何で検査するか」を決める。前者は Runtime の
`aiTaskRequestSchema` と BFF の門が、後者は Runtime の Structured Output 再試行と BFF の
再検査が、それぞれ自分の複製から引く（ADR-0011 により Runtime と BFF は独立した実装を持つ）。

**同じ判断をプロジェクト内の2箇所に書かない。** プロジェクトをまたぐ二重実装（Runtime と BFF が
別々に `outputSchemaFor` を持つこと）自体は ADR-0011 で受け入れた設計だが、それでも
**入出力の形を変える変更は3つの複製すべてに手で反映する。** 片方だけが追随すると、BFF は
通すのに Runtime が弾く（またはその逆の）状態になる — これは自動検知されず、実運用の
`PARSE_FAILED` で初めて顕在化する。

## リクエストに何が載るか

**交通ICを除く3タスクが構造化入力 `input` として画面の状態を受け取る**（ADR-0005 が ADR-0003 を
撤回した）。何を載せるかは taskId ごとに違い、`INPUT_SCHEMAS` が正典。

| taskId | `input` |
| --- | --- |
| `ic-card.parse-reservation` | `null`（送るべき画面状態が無い。基準時刻は system prompt が持つ） |
| `meeting.parse-candidates` | 所要時間・カレンダーの表示範囲（`calendar_start` / `calendar_end`）。既に選択済みの候補日程は送らない |
| `meeting.parse-availability` | 参加形式・所要時間・候補日程の一覧 |
| `meeting.recommend-schedule` | 参加形式・所要時間・参加者の名簿・参加可否表 |

**`input` はサニタイズも Guardrail チェックも通さないので自由文字列を置かない**（ADR-0004 の制約が
3タスクへ広がった）。候補日程は `/^candidate-\d{1,6}$/`、参加者は `/^参加者[A-Z]$/`。参加者の実名を
送らないのは ADR-0008。

**識別子はフロントエンドが発番し、AI は自分では作らない。** 候補日程を選ぶ2つの出力
（`meeting.parse-availability` / `meeting.recommend-schedule`）は `candidate_id` だけを返し、日付や
開始時刻を写さない。入力に無い識別子が返っていないかは `output-schema.ts` の2関数が見る（Runtime の
再試行と BFF の再検査の両方から `outputSchemaFor` 越しに引かれる）。新しい候補日程を作る
`meeting.parse-candidates` は逆に識別子を返さない — 選ぶべき既存の識別子が無いため。

**この2つは抜けの扱いが逆。** `findRecommendationMismatch` は過不足なく対応することを要求し、
`findAvailabilityMismatch` は**抜けを許して重複だけ弾く** — 判定できなかった候補日程は要素を
持たないことで表す（`null` を返させない）ので、抜けは失敗ではなく画面が聞き返す材料になる。

**候補日程は終了時刻を持たない。** 終わる時刻は会議の所要時間から導く。導出が要るのは画面だけ
なので、関数は `nextjs-app/app/lib/meeting-info.ts` にある（誰も引かない関数を契約に置かない）。

自然文の必須性は `PROMPT_REQUIREMENT`（`prompt-requirement.ts`）が taskId ごとに持つ
（`OUTPUT_SCHEMAS` / `INPUT_SCHEMAS` と対称）。「毎回送り直す」理由は ADR-0004 にある。

## Web 検索の出典は AI の出力と別に運ぶ

`AiTaskSuccessResponse.citations` は **Runtime が実際に取得した Search Result の出典**で、
AI が書いた `result.sources` とは別物である。**表示の正典はこちら。**

AWS の Web Search Tool の「許容される利用方法」が、Search Result を使った出力に出典
（`title`）とリンク（`url`）を添えて表示することを義務づけている（`docs/reference-doc-fixes.md`
F-27）。`sources` はモデルの申告なので、**使ったのに載せない**ことも、検索結果に無い URL を
混ぜることもある。**遵守をモデルの協力に依存させない。**

本文（`text`）は運ばない。**表示の義務が掛かっているのは出典とリンクであって本文ではなく、**
載せると応答が1件あたり数千字ぶん太るためである。

**「一括での抽出・保存・再現の禁止」をこの理由にしないこと。** あの条項が禁じるのは bulk での
収集であって、検索結果の内容を回答の根拠に使うことではない — Runtime は現に本文をモデルへ
渡している。条項が効くのは**検索結果を溜める・永続化する・索引を作る**使い方をしたときで、
ログや監査に検索結果の本文を残す設計を足すならそこで効く。

BFF は壊れた出典を**黙って落とさず** `PARSE_FAILED` にする。落とすと、規約に反したまま
画面が成功として描く。

## フロントエンドが値として引くファイル

`meeting.ts`・`recommendation.ts`・`prompt-requirement.ts`。この3つには2つの制約が掛かる。

**zod を import しない。** スキーマと同じモジュールに置くと SSG のバンドルに zod が丸ごと乗る。

**`nextjs-app/app/lib/contracts/` の他のモジュールも値として import しない。** 引けるのは `import type` だけである。
相対 import の `.js` は Runtime の NodeNext が要求する形だが、フロントエンドのバンドラ
（Turbopack / webpack）はそれを `.ts` に読み替えない — `moduleResolution: bundler` の読み替えは
tsc の中だけの話で、`next.config.ts` から効かせる手も無い（`resolveAlias` も `resolveExtensions` も
届かない）。型だけの import は emit 時に消えるので、この制約は**値として引くモジュールにだけ**掛かる。
`next build` が「Module not found: Can't resolve './meeting.js'」で落ちたらこれである。

`meeting.ts` が持つのは**値域と、値域だけで答えられること**（参加形式3値・参加可否4状態・
所要時間の選択肢・候補日程の識別子の形と発番・件数の上限・`isAttending`）。Zod スキーマは
`fields.ts` がここから導く。画面が値として要るものはここに置くしかないので、**「zod を使わずに
書けるか」が置き場所の基準**になる。

`recommendation.ts` が持つのは**候補日提案の導出と集計**（ADR-0007）— AI評価ラベルの閾値と導出、
参加可否表からの集計（参加可能人数・現地／リモートの内訳・欠席者・未回答者数）、AI 提案の発火閾値、
開催日・予備日の初期選択。**AI に数えさせない**ための場所である。上の制約から `isAttending` を
呼べないので、参加可否4状態を1つの `switch` で網羅して内訳の和を採る。

## 置き場所

- `agent-app/app/FormEchoAgent/contracts/` — Runtime 内のパッケージなので `./contracts/index.js`
  として相対 import する。`agent-app` 自身の `node_modules` から `zod` を解決するので、
  `paths` エイリアスも symlink も要らない
- `hono-app/src/schemas/` — 同様に `hono-app` 自身のパッケージ内から相対 import する
- `nextjs-app/app/lib/contracts/` — `nextjs-app` 自身のパッケージ内から相対 import する

3箇所とも自分のプロジェクトの通常の依存解決（各自の `node_modules`）で完結し、他プロジェクトの
ファイルは一切参照しない。**Zod は3プロジェクトとも v4 に揃える。**
