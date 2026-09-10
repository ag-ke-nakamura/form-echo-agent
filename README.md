# FormEcho

AWS Bedrock AgentCore を使ったエージェントと、それに付随するフロントエンドの実験を収めたリポジトリ。

## 構成

3つのプロジェクトと、デプロイ済み検証環境の CDK アプリ `infra/`（ADR-0014）を並べています。`hono-app` と `nextjs-app` の2つはルートの pnpm workspace のメンバーで、`agent-app` は npm 管理のまま外にいます（ADR-0015）。

| ディレクトリ | 内容 | パッケージ管理 |
| --- | --- | --- |
| `agent-app/` | AgentCore プロジェクト本体。`agentcore` CLI の生成物一式 | npm |
| `hono-app/` | Hono スキャフォールド（`dev` のみ Bun ランタイム） | pnpm |
| `nextjs-app/` | Next.js 16 スキャフォールド | pnpm |
| `infra/` | デプロイ済み検証環境の front door（S3 + CloudFront）。デプロイは `mise run deploy:infra` | npm |

## セットアップ

開発ツールは [mise](https://mise.jdx.dev) で管理しています。

AWS に触る作業（デプロイ、`mise run dev:deployed`）をするなら、ルートに `.env` を置きます。雛形が `.env.example` にあります。

```sh
cp .env.example .env   # AWS_PROFILE を自分のプロファイル名に書き換える
```

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

デプロイ先は `agent-app/agentcore/aws-targets.json` に定義します。デプロイ手順は下の「AWS へのデプロイ」を参照してください。

スキーマと CLI の全リファレンスは `agent-app/AGENTS.md`（CLI の生成物）にあります。

## AWS へのデプロイ

**デプロイは人が手元から実行します。** CI にデプロイ用の OIDC ロールは作っていません。

### どのアカウントに出るか

`mise` はリポジトリルートの `.env`（git 管理外）を読み込むので、**そこに `AWS_PROFILE` を書きます。** `mise run` 側に profile を渡す口はありません。

```sh
# .env（雛形は .env.example）
AWS_PROFILE=<開発機のプロファイル名>
```

```sh
aws login          # または aws sso login。認証情報そのものは .env に置かない
aws sts get-caller-identity   # 出先が意図したアカウントかを確認する
```

`.env` にキーを直書きしないでください（失効したときに同じ場所で詰まります）。置くのは「どのプロファイルを使うか」だけです。profile 名を `mise.toml` に固定していないのは、開発機に他案件のプロファイルが並んでいて、開発者ごとに名前が違うためです。

アカウントの決まり方はデプロイ対象で違います。

| 対象 | account | region |
| --- | --- | --- |
| Runtime（`agentcore deploy`） | `agent-app/agentcore/aws-targets.json` に固定（コミット済み） | 同じファイルに固定 |
| `agent-app/infra` / `infra` の CDK | 実行時の資格情報から CDK が解決（`CDK_DEFAULT_ACCOUNT`） | `ap-northeast-1` にコード上で固定 |

CDK 側はアカウントを固定していないので、**`AWS_PROFILE` を取り違えると別アカウントに出ます。** `aws-targets.json` と食い違っていれば `agentcore deploy` は止まりますが、CDK は止まりません。

`aws-targets.json` を空配列 `[]` にしておくと、`agentcore deploy` が資格情報から account と region を検出して `default` ターゲットを**ファイルに書き戻します**（CLI の `ensureDefaultDeploymentTarget`）。

**手元では空にせず、デプロイ先を固定してコミットします。** 空だと region がプロファイルの既定に従ってしまい（ADR-011 の ap-northeast-1 固定が崩れる）、`AWS_PROFILE` の取り違えを止める役目も失うためです。

**このリポジトリを他所へ渡すときは逆に空にします。** 相手は初回の `agentcore deploy` で自分のアカウントが埋まるので、ファイルを手で書き換える手順が要りません。ただし空にするのは `aws-targets.json` だけでは足りません — アカウント ID は次のファイルにも入っており、いずれもデプロイの生成物としてコミットされています。

- `agent-app/agentcore/.cli/deployed-state.json`（`infra` の synth がここから Runtime ARN を読む。#139）
- `agent-app/infra/cdk.json` の `context.runtimeRoleArn`
- `mise.toml` の `FORMECHO_RUNTIME_ARN` と `FORMECHO_WEB_SEARCH_GATEWAY_URL`

空にして渡す場合は、`mise.toml` の `[tasks."deploy:agent"]` に `AWS_REGION = "ap-northeast-1"` を足してください。自動検出の region は AWS SDK の解決チェーンに従うため、これが無いと相手のプロファイルの既定 region に出ます。

### 順番

**初回は `mise run deploy:all` で3つを順に回せます。** 以下はその中身で、2回目からは変えたところだけを個別に打ちます。

順番に依存があります。Runtime を先に出さないと、front door の synth が読む Runtime ARN（`agentcore deploy` が書く `deployed-state.json`。#139）が無く、`agent-app/infra` が参照する実行ロールも決まりません。

| # | コマンド | 何が出るか | いつ回すか |
| --- | --- | --- | --- |
| 1 | `mise run deploy:agent` | AgentCore Runtime（`agent-app/`） | Runtime のコードや `agentcore.json` を変えたとき |
| 2 | `mise run deploy:agent-infra` | Runtime 実行ロールへの Guardrail 許可（ADR-0010） | **1 で実行ロールが変わったときだけ。** ロール ARN のキャッシュを `depends` で先に回します |
| 3 | （手作業）`mise.toml` の ARN 更新 | — | 1 で Runtime ARN / Gateway URL が変わったとき |
| 4 | `mise run deploy:infra` | front door（S3 + CloudFront + BFF Lambda、ADR-0014） | フロントエンド・BFF を変えたとき |

3 は `deploy:all` にも含まれません（`mise.toml` 自身の書き換えなので自動化していない）。`agent-app/agentcore/.cli/deployed-state.json` の `runtimeArn` と `gatewayUrl` を、それぞれ `[tasks."dev:deployed".env]` の `FORMECHO_RUNTIME_ARN` と `[tasks."dev:runtime".env]` の `FORMECHO_WEB_SEARCH_GATEWAY_URL` に写します。ここを忘れると、`mise run dev:deployed` が古い Runtime を向いたまま動きます。

素の `deploy` は置いていません。デプロイ先が3つある以上、どれか1つだけを指す名前としては誤解を招きます。全部回すなら `deploy:all` です。

4 は `FORMECHO_BASIC_AUTH_PASSWORD` が要ります（`.env` に置く。未設定ならスタックが理由の分かるエラーで止まります）。フロントエンドのビルドは `depends` に入っているので別途叩く必要はありません。

デプロイせずに手元で3プロセスを動かすときは `mise run dev`、BFF だけデプロイ済み Runtime を向けるときは `mise run dev:deployed` です。

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
