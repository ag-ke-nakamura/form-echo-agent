---
paths:
  - "agent-app/agentcore/cdk/**/*"
---

# agent-app/agentcore/cdk

**`agentcore` CLI の生成物のため編集不可。** コマンドは `npm run build` / `npm run format`。

CI は format と build のみ（`npm test` は生成されたテストが空 spec の synth しか見ておらず build と重複するため意図的に外している）。意味のある検証は「実際の `agentcore.json` が synth できるか」= `cdk synth` だが、`aws-targets.json` が空のため現時点では実行できない。

## `@aws/agentcore-cdk` はキャレットを付けずに固定する

`agentcore create` は `^0.1.0-alpha.19` を宣言するが、この範囲は最新 alpha を招き入れ、生成コードは古い API 世代に対して書かれているため**生成した瞬間に build が壊れる**（実際 alpha.49 の `connectorName` → `connector` 変更で Initial commit から壊れていた。alpha.51 が両形を受け付けるので固定して解消）。CLI を更新しても直らない。

このディレクトリは dependabot のバージョン更新を止めてある（理由は `.github/dependabot.yml` のコメント）。手で上げるときは必ず `npm run build` を通し、壊れていたら直近の互換 alpha に戻す。
