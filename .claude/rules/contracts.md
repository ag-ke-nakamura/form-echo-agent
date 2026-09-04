---
paths:
  - "contracts/**/*"
  - "**/tsconfig*.json"
  - "hono-app/src/**/*"
  - "agent-app/app/FormEchoAgent/invocation/**/*"
  - "nextjs-app/app/lib/**/*"
---

# contracts（入出力の契約）

出力スキーマ（Zod）・リクエスト型・エラーコード・`taskId` 許可リストの正典。

## 判断は契約側の関数に置く

`checkTaskInput(taskId, {prompt, input})` が「このリクエストが入力契約を満たすか」を、
`outputSchemaFor(taskId, input)` が「この応答を何で検査するか」を決める。前者は Runtime の
`aiTaskRequestSchema` と BFF の門の両方が、後者は Runtime の Structured Output 再試行と
BFF の再検査の両方が引く。

**同じ判断を2箇所に書かない。** 片方だけが契約の変更に追随すると、BFF は通すのに Runtime が
弾く（またはその逆の）状態になる。

## リクエストに何が載るか

**交通ICを除く3タスクが構造化入力 `input` として画面の状態を受け取る**（ADR-0005 が ADR-0003 を
撤回した）。何を載せるかは taskId ごとに違い、`INPUT_SCHEMAS` が正典。

| taskId | `input` |
| --- | --- |
| `ic-card.parse-reservation` | `null`（送るべき画面状態が無い。基準時刻は system prompt が持つ） |
| `meeting.parse-candidates` | 所要時間のみ。既に選択済みの候補日程は送らない |
| `meeting.parse-availability` | 参加形式・所要時間・候補日程の一覧 |
| `meeting.recommend-schedule` | 参加形式・所要時間・参加者の名簿・参加可否表 |

**`input` はサニタイズも Guardrail チェックも通さないので自由文字列を置かない**（ADR-0004 の制約が
3タスクへ広がった）。候補日程は `/^candidate-\d{1,6}$/`、参加者は `/^参加者[A-Z]$/`。参加者の実名を
送らないのは ADR-0008。

**識別子はフロントエンドが発番し、AI は自分では作らない。** 候補日程を選ぶ出力
（`meeting.recommend-schedule`）は `candidate_id` だけを返し、日付や開始時刻を写さない。入力に無い
識別子が返っていないかは `findRecommendationMismatch` が見る（Runtime の再試行と BFF の再検査の
両方から `outputSchemaFor` 越しに引かれる）。新しい候補日程を作る `meeting.parse-candidates` は
逆に識別子を返さない — 選ぶべき既存の識別子が無いため。

**候補日程は終了時刻を持たない。** 終わる時刻は会議の所要時間から導く。導出が要るのは画面だけ
なので、関数は `nextjs-app/app/lib/meeting-info.ts` にある（誰も引かない関数を契約に置かない）。

自然文の必須性は `PROMPT_REQUIREMENT`（`prompt-requirement.ts`）が taskId ごとに持つ
（`OUTPUT_SCHEMAS` / `INPUT_SCHEMAS` と対称）。「毎回送り直す」理由は ADR-0004 にある。

## zod を import してはいけないファイル

`meeting.ts` と `prompt-requirement.ts`。フロントエンドがこの2つだけを**値として**引くので、
スキーマと同じモジュールに置くと SSG のバンドルに zod が丸ごと乗る。`meeting.ts` が持つのは
値域そのもの（参加形式3値・参加可否4状態・所要時間の選択肢）で、Zod スキーマは `fields.ts` が
ここから導く。

## 参照のしかたはプロジェクトごとに違う

- `hono-app` / `nextjs-app` — tsconfig の `paths` で `@contracts/*` を張る。どちらも emit しない
  （`tsc --noEmit` / bundler）ので `rootDir` の制約を受けない
- `agent-app/app/FormEchoAgent` — **`contracts` という symlink がパッケージ内にあり、
  `./contracts/index.js` として相対 import する。** ここだけ `paths` を使わない

**この symlink を消さないこと。** `tsc` は emit するので `rootDir` の外のファイルを取り込めず
（TS6059）、`paths` エイリアスは emit 後の import 文にそのまま残るため Node が実行時に解決できない
（`tsc` はエイリアスを書き換えない）。symlink なら `rootDir` 配下として扱われ、`dist/contracts/*.js`
が実体として出力される。将来 CodeZip で固めるときも同じ理由で必要になる。

あわせて各プロジェクトの tsconfig には `"zod": ["./node_modules/zod"]` の `paths` がある。
`contracts/` 自身の位置からは `node_modules` を辿れないため。`contracts/package.json` は
`{"type": "module"}` だけを宣言するモジュール種別のマーカーで、依存もスクリプトも持たない。

**Zod は3プロジェクトとも v4 に揃える。**

整形は `agent-app/app/FormEchoAgent` の biome で見る（どのプロジェクトにも属さないため）。
`./node_modules/.bin/biome check ../../../contracts`
