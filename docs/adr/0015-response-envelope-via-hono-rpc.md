# 応答封筒だけを Hono RPC で共有し、出力契約は複製のまま残す

- **Status**: accepted
- **Date**: 2026-09-08
- **Amends**: ADR-0011

ADR-0011 は「3プロジェクトがそれぞれ自己完結の複製を持ち、他プロジェクトのファイルは一切
参照しない」と決めた。動機は2つあった — F-26（CodeZip の esbuild が `contracts/` の symlink 越しに
`zod` を解決できない）と、「この検証環境の後は3プロジェクトをそれぞれ独立稼働する本番
プロジェクトへ配布する計画」である。

このうち **F-26 は `agent-app` の CodeZip バンドルの問題なので `nextjs-app` ↔ `hono-app` には
掛からない。** 配布計画については、**`nextjs-app` と `hono-app` は組で配布される**ことが確認できた。
2つの間の型依存は配布後も生き残るので、ADR-0011 の2つの動機はどちらもこの1辺には効かない。

**`nextjs-app` ↔ `hono-app` の1辺に限って型依存を認め、応答封筒（`CONTEXT.md`）を Hono RPC の
`AppType` から引く。** `nextjs-app` が複製で持っていた `sessionId` / `usage` / `citations` /
エラーの `code`・`message`、および `AiErrorCode` は BFF から型で届くようにし、複製を消す。

**出力契約（Runtime が返す Structured Output のスキーマ）は3プロジェクトの複製のまま。**
`AppType` から届く `result` は `unknown` で、画面が自分の `TaskOutputMap` で絞る。`agent-app` との
2辺には ADR-0011 がそのまま効く。**この ADR が改訂するのは1辺だけである。**

`TaskId` も複製に残す。`AppType` に載せるには BFF の入力の門を `zValidator` へ寄せる必要があり、
`taskId` の照合を `prompt` の検査より先に置く順序と、分岐ごとに違うエラーコード
（`INVALID_TASK_ID` / `INVALID_INPUT`）を custom hook で書き直すことになる。`TaskId` は4値の
リテラル union で、増えるときは3プロジェクトすべてに手を入れる作業なので、そこで静かに
漏れる型ではない。

型の運び方は **pnpm workspace の依存解決**（`hono-app/package.json` の `exports` が
`./src/index.ts` を指し、`nextjs-app` が `import type { AppType }` で引く）。workspace に入れるのは
`nextjs-app` と `hono-app` の2つだけで、npm 管理の `agent-app` は入れない。

## Considered Options

- **ADR-0011 のまま封筒も複製で持つ**: 封筒のドリフトが型で検知されない。`api.ts` の
  `citations ?? []`（「この欄を持たない版の BFF」への防御）が現にその跡である
- **`hono-app` が `.d.ts` を emit し、それを引く**: Hono 公式が Known issues で挙げる
  `hcWithType`（型の前計算）に近い形。しかし `hcWithType` 自体は**値**なので、引くには `.d.ts` だけで
  なく JS の emit まで必要で、それは `nextjs-app` に値の cross-project import を作る
  （`rules/contracts.md` が記録している「相対 import の `.js` をバンドラが `.ts` に読み替えない」
  問題が復活する）。`.d.ts` だけなら `nextjs-app` 側の形は workspace 解決と同じで、
  第2 tsconfig・ビルド手順・CI の順序依存・clone 直後に `dist` が無い状態の面倒を足すだけになる。
  **公式が前計算を要求する条件はルートが多く IDE が遅いことで、こちらはルートが2本**
- **`zValidator` まで寄せて `TaskId` も流す**: 上記のとおり入力の門の作り直しになる
- **応答封筒と `AiErrorCode` だけを workspace 解決で引く（採用）**

## Consequences

- **封筒のドリフトが型エラーになる。** `error-guidance.ts` の `Record<AiErrorCode, ErrorGuidance>` が
  網羅を要求するので、BFF がエラーコードを増やすと画面がコンパイルエラーになる。
  `GUARDRAIL_BLOCKED` が後から足された前例があり、**行数（`types.ts` の約50行）より
  こちらが本命である**
- **ルートに `package.json` と `pnpm-workspace.yaml` を置くことになる。** CLAUDE.md の
  「ルートに `package.json` やワークスペース定義は無い」は書き換える。ADR-0011 が却下した
  `packages/contracts` 化は3プロジェクトすべてを1 workspace に入れる案だったが、pnpm の2つだけなら
  npm 管理の `agent-app` を巻き込まない
- **per-project の `pnpm-lock.yaml` が root の1つに統合される。** CI の `hono-app` /
  `nextjs-app` ジョブはそれぞれ `working-directory` で `pnpm install --frozen-lockfile` しているので、
  この2ジョブが変わる
- `nextjs-app` の tsc が `hono-app` のソースを型グラフに取り込む。**`hono` のバージョンは両側で
  揃える**必要がある（ずれると "Type instantiation is excessively deep and possibly infinite"）。
  `hono` は `nextjs-app` の **dependency** になる — `hc` は値なのでブラウザへ配られる
- **ルートが増えて IDE か `next build` が体感で遅くなったら `.d.ts` emit へ移る。** それが Hono 公式が
  型の前計算を要求している条件であり、今そこに無いことがこの ADR の前提である
- 出力契約の3方向のドリフトは ADR-0011 のまま自動検知しない。塞がるのは BFF ↔ 画面の封筒だけ
