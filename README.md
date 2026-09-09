# FormEcho

AWS Bedrock AgentCore を使ったエージェントと、それに付随するフロントエンドの実験を収めたリポジトリ。

## 構成

3つのプロジェクトと、デプロイ済み検証環境の CDK アプリ `infra/`（ADR-0014）を並べています。`hono-app` と `nextjs-app` の2つはルートの pnpm workspace のメンバーで、`agent-app` は npm 管理のまま外にいます（ADR-0015）。

| ディレクトリ | 内容 | パッケージ管理 |
| --- | --- | --- |
| `agent-app/` | AgentCore プロジェクト本体。`agentcore` CLI の生成物一式 | npm |
| `hono-app/` | Hono スキャフォールド（`dev` のみ Bun ランタイム） | pnpm |
| `nextjs-app/` | Next.js 16 スキャフォールド | pnpm |
| `infra/` | デプロイ済み検証環境の front door（S3 + CloudFront）。デプロイは `mise run deploy` | npm |

## セットアップ

開発ツールは [mise](https://mise.jdx.dev) で管理しています。

```sh
mise install          # node, python, pnpm, bun, lefthook, betterleaks, aws-cli 等
lefthook install      # pre-commit / pre-push フックを有効化
```

依存を入れます。pnpm の2プロジェクトはリポジトリルートで一度に入り（`pnpm-lock.yaml` は workspace に1つ）、npm の `agent-app` は個別です。

```sh
pnpm install
(cd agent-app/agentcore/cdk && npm ci)
(cd agent-app/app/FormEchoAgent && npm ci)
(cd infra && npm ci)
```

## agent-app

`agentcore` コマンドは **`agent-app/` 内で実行**します。CLI は自分のいるフォルダをプロジェクトルートとして扱うため、リポジトリルートからは認識されません。

```sh
cd agent-app
agentcore validate    # 設定の検証
agentcore dev         # ローカル実行（ホットリロード）
agentcore deploy      # AWS へデプロイ
```

デプロイ先は `agent-app/agentcore/aws-targets.json` に定義します。**現在は空のため、`agentcore deploy` と `cdk synth` は実行できません。**

スキーマと CLI の全リファレンスは `agent-app/AGENTS.md`（CLI の生成物）にあります。

## 開発ハーネス

| 段階 | 内容 |
| --- | --- |
| pre-commit | secret scan（betterleaks）、各プロジェクトの format / lint / typecheck、破壊的コマンドガードの回帰テスト |
| pre-push | push 範囲全体の secret scan |
| CI | 上記に加えて各プロジェクトの build と、`nextjs-app` のテスト（vitest） |

フォーマッター・リンター・型チェッカーは各プロジェクトの devDependency として持ち、`npm exec` / `pnpm exec` 経由で呼びます（`mise.toml` には置きません）。理由は `CLAUDE.md` を参照してください。

依存の更新方針（どのディレクトリを凍結し、どれをグループ化するか）は `.github/dependabot.yml` のコメントに記載しています。

## 言語

ドキュメント、コミットメッセージ、コードコメントはすべて日本語で記述します。
