# Issue tracker: GitHub

このリポジトリの issue と spec は GitHub Issues（`ag-ke-nakamura/form-echo-agent`）に置く。操作はすべて `gh` CLI 経由で行う。

## 規約

- **issue を作る**: `gh issue create --title "..." --body "..."`。複数行の body はヒアドキュメントを使う。
- **issue を読む**: `gh issue view <number> --comments`。コメントは `jq` で絞り、ラベルも併せて取得する。
- **issue を一覧する**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` に `--label` / `--state` を適宜付ける。
- **コメントする**: `gh issue comment <number> --body "..."`
- **ラベルを付ける / 外す**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **閉じる**: `gh issue close <number> --comment "..."`

対象リポジトリは `git remote -v` から判定する。clone 内で実行すれば `gh` が自動で解決する。

## triage 対象としての pull request

**PR を要望の受け口として扱うか: no.** _（外部からの PR を機能要望として扱うなら `yes` に変える。`/triage` がこのフラグを読む。）_

`yes` にした場合、PR は issue と同じラベル・状態遷移を通り、`gh pr` 系のコマンドを使う。

- **PR を読む**: `gh pr view <number> --comments`、差分は `gh pr diff <number>`。
- **triage 対象の外部 PR を一覧する**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` を実行し、`authorAssociation` が `CONTRIBUTOR` / `FIRST_TIME_CONTRIBUTOR` / `NONE` のものだけ残す（`OWNER` / `MEMBER` / `COLLABORATOR` は落とす）。
- **コメント / ラベル / クローズ**: `gh pr comment`、`gh pr edit --add-label` / `--remove-label`、`gh pr close`。

GitHub は issue と PR で番号空間を共有するため、単なる `#42` はどちらの可能性もある。`gh pr view 42` を試し、失敗したら `gh issue view 42` にフォールバックする。

## スキルが「issue tracker に publish する」と言ったとき

GitHub issue を作る。

## スキルが「該当チケットを取得する」と言ったとき

`gh issue view <number> --comments` を実行する。

## Wayfinding の操作

`/wayfinder` が使う。**map** は単一の issue で、**child** issue がチケットになる。

- **map**: `wayfinder:map` ラベルを付けた1つの issue。body に Notes / Decisions-so-far / Fog を持つ。`gh issue create --label wayfinder:map`。
- **child チケット**: GitHub の sub-issue として map に紐づけた issue（sub-issues エンドポイントに対する `gh api`）。sub-issues が使えない場合は map の body のタスクリストに child を追加し、child の body 先頭に `Part of #<map>` を書く。ラベルは `wayfinder:<type>`（`research` / `prototype` / `grilling` / `task`）。claim されたら担当開発者を assignee にする。
- **ブロック関係**: GitHub ネイティブの issue dependencies を正典とする（UI から見える）。エッジの追加は `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`。`<blocker-db-id>` はブロッカーの数値 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`。`#number` や `node_id` ではない）。GitHub は `issue_dependencies_summary.blocked_by`（open なブロッカーのみ = 実際のゲート）を返す。dependencies が使えない場合は child の body 先頭の `Blocked by: #<n>, #<n>` 行にフォールバックする。すべてのブロッカーが閉じられた時点でチケットはアンブロック。
- **frontier クエリ**: map の open な child を一覧し（`gh issue list --state open` を map の sub-issues / タスクリストに絞る）、open なブロッカーを持つもの（`issue_dependencies_summary.blocked_by > 0`、または `Blocked by` 行に open な issue がある）と assignee 付きのものを落とす。map 上の順序で先頭が勝つ。
- **claim**: `gh issue edit <n> --add-assignee @me`。セッション最初の書き込み操作。
- **resolve**: `gh issue comment <n> --body "<answer>"` → `gh issue close <n>` → map の Decisions-so-far にコンテキストへのポインタ（gist + リンク）を追記。
