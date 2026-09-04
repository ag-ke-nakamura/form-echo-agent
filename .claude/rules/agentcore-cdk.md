---
paths:
  - "agent-app/agentcore/cdk/**/*"
---

# agent-app/agentcore/cdk

**`agentcore` CLI の生成物のため編集不可。** コマンドは `npm run build` / `npm run format`。

CI は format と build のみ（`npm test` は生成されたテストが空 spec の synth しか見ておらず build と重複するため意図的に外している）。意味のある検証は「実際の `agentcore.json` が synth できるか」= `cdk synth` で、**`aws-targets.json` が埋まった今は実行できる**（#46）。ただし `runtimes` を含むと CodeZip の esbuild が `contracts/` 越しに `zod` を解決できずに落ちる（`docs/reference-doc-fixes.md` F-26）。

## `@aws/agentcore-cdk` はキャレットを付けずに固定する

`agentcore create` は `^0.1.0-alpha.19` を宣言するが、この範囲は最新 alpha を招き入れ、生成コードは古い API 世代に対して書かれているため**生成した瞬間に build が壊れる**（実際 alpha.49 の `connectorName` → `connector` 変更で Initial commit から壊れていた）。CLI を更新しても直らない。

**現在の固定は alpha.50。** 一度 alpha.51 に上げていたが、`agentcore deploy` が CLI 0.28.1 の期待（alpha.50）より新しい依存を `CliVersionTooOldError` で拒む（#46 / F-25）。`validate` と `cdk synth` は通るので **deploy するまで気付けない**。エラーが案内する `npm install -g @aws/agentcore@latest` は効かない — **0.28.1 が最新**である。alpha.50 でも build は通るので、上げる側ではなく下げる側で噛み合わせた。

**上げるときは CLI が期待するバージョンを先に確かめる。** `npm run build` が通っても deploy が落ちる。

このディレクトリは dependabot のバージョン更新を止めてある（理由は `.github/dependabot.yml` のコメント）。手で上げるときは必ず `npm run build` を通し、壊れていたら直近の互換 alpha に戻す。

## `agentcore deploy` が package.json を書き換える

CLI は「テスト済みの版」に依存を寄せる機能を持っており、**deploy のたびにキャレットをチルダへ書き換えて `npm install` まで走らせる**（#46 で実際に起きた。`aws-cdk-lib` `^2.248.0` → `~2.261.0`、`@types/node` `^22.20.1` → `~24.13.3` など）。

**`@types/node` が 24 系になるのは `mise.toml` の node 22 と食い違う**が、`npm run build` は通るので受け入れている。生成物のディレクトリなので、この書き換えを差し戻しても次の deploy で戻る。止めるなら `agentcore config disableDependencyManagement true`（CLI のグローバル設定）だが、そうすると F-25 のバージョンゲートを自力で管理することになる。
