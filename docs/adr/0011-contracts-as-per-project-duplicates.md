# 出力契約の共有をやめ、3プロジェクトがそれぞれ自己完結の複製を持つ

- **Status**: accepted
- **Date**: 2026-09-07
- **Supersedes**: ADR-0002

ADR-0002 が採った「リポジトリルートの `contracts/` を symlink（`agent-app`）と tsconfig の `paths`（`hono-app`・`nextjs-app`）から参照する」構成は、Runtime を実際に AWS へデプロイする段階で破綻した。CDK の CodeZip バンドル（esbuild）が `contracts/` の symlink を実体パスへ解決してしまい、そこから `node_modules` を辿れず `zod` を解決できないため synth が失敗する（F-26）。

加えて、この検証環境の後は `agent-app` / `hono-app` / `nextjs-app` をそれぞれ独立稼働する本番プロジェクトへ配布する計画がある。単一の `contracts/` を前提にした構成は、3アプリが疎結合に独立稼働するという将来像そのものと整合しない。

**`contracts/` という共有ディレクトリへの依存をやめ、3プロジェクトがそれぞれ自分に必要な範囲だけを自分のコードベース内に複製して持つ。** 複製の起点は `contracts/` の内容そのままで、この変更で入出力の形（フィールド名・型・許容値）は一切変えていない。

- `agent-app/app/FormEchoAgent/contracts/` — リクエスト検証・出力検査と作り直し判定（`outputSchemaFor`）・taskId 許可リストとドメイン解決・エラーコード・値域の一部・自然文必須性判定
- `hono-app/src/schemas/` — 入力ゲート（`checkTaskInput`）・Runtime 応答の再検査（`outputSchemaFor`）・taskId 許可リスト・エラーコード・`sessionId` 検証・usage/citations の型
- `nextjs-app/app/lib/contracts/` — 画面が送る `input` に要る値域全体・候補日提案の導出集計（`recommendation.ts`。他プロジェクトは使っていないためここにしか無い）・自然文必須性判定・エラーコードの表示語彙

`outputSchemaFor`・`checkTaskInput` 相当の判定ロジックを `agent-app` と `hono-app` が独立に持つ二重実装は、正式な設計として受け入れる。

## Considered Options

- **ADR-0002 の構成を維持し、symlink 側だけ別の回避策を探す（`contracts/node_modules` を Runtime の `node_modules` への symlink にする等）**: synth は通ることを確認したが、`nextjs-app` / `hono-app` のバンドラが `contracts/` 経由で `agent-app` の `zod` を引く経路ができてしまい、副作用が読めない
- **`packages/contracts` として pnpm workspace 化する**: 本番の姿に最も近いが、npm 管理の `agent-app` を同じ workspace に取り込めず、`CLAUDE.md` の「ルートに `package.json` を置かない」方針の変更も伴う
- **3プロジェクトがそれぞれ自己完結の複製を持つ（採用）**: 3方向のドリフトを許容する代わりに、symlink/`paths` の制約から解放され、将来3プロジェクトを別リポジトリへ切り出す際にも構成を変えずに済む

## Consequences

- **3プロジェクト間でスキーマの内容が将来食い違いうる。** 新しい契約テスト・統合テストは意図的に作らない。ドリフトは実運用で顕在化する前提を受け入れる — `hono-app` の `outputSchemaFor` 再検査が Runtime の応答を弾けば `PARSE_FAILED` になる。これがサイレントな不整合の歯止め
- スキーマを変更するときは対象プロジェクトの複製だけを直せばよくなった一方、**入出力の形を変える変更は複製先すべてに手で反映する必要がある。** 「同じ判断を2箇所に書かない」という `contracts.md` の原則は、プロジェクトをまたいでは適用されなくなり、各プロジェクト内でだけ効く
- `agent-app/app/FormEchoAgent/contracts` はもう symlink ではなく実体のファイルなので、`agent-app` 自身の `node_modules` から `zod` を解決できる。CodeZip バンドルが `contracts/` 越しに `zod` を解決できないという F-26 の症状そのものは構造的に解消したが、**`agentcore deploy` の実行と synth が実際に通るかの確認は本 ADR のスコープ外**（実クラウドリソースを作る操作のため、人が別途確認する。#45）
