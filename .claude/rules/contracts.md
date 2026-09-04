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

**抽出系3タスクのリクエストは `{taskId, prompt, sessionId}` だけで、画面が持っているフォームの
状態を Runtime へ渡さない。`prompt` にシステムが組み立てた文脈を埋め込むこともしない**（ADR-003）。
突き合わせはフロントエンドが行う。

**推薦系 `meeting.recommend-schedule` だけは構造化入力 `input` を渡す**（ADR-0004）。`input` は
サニタイズも Guardrail チェックも通さないので**自由文字列を置かない**。入力契約は `INPUT_SCHEMAS`、
自然文の必須性は `PROMPT_REQUIREMENT`（`prompt-requirement.ts`）が taskId ごとに持つ
（`OUTPUT_SCHEMAS` と対称。自然文だけのタスクは `null` を明示）。参加者の形と「毎回送り直す」
理由は ADR-0004 にある。

> #67 が ADR-0005 で ADR-003 を撤回し、3タスクが `input` を受け取るようになる。着手時にこの節を
> 書き換えること。

## zod を import してはいけないファイル

`candidate-key.ts` と `prompt-requirement.ts`。フロントエンドがこの2つだけを**値として**引くので、
スキーマと同じモジュールに置くと SSG のバンドルに zod が丸ごと乗る。

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
