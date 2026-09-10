# infra

**デプロイ済み検証環境**の front door を持つ CDK アプリ（ADR-0014）。スタックは
`FormEchoFrontDoor` の1つで、S3（非公開）+ CloudFront + OAC によるフロントエンドの
配信、その手前の Basic 認証（#138）、`/api/*` に繋いだ BFF の Lambda + Function URL
（#139）を持つ。オリジンは CloudFront 1つなので CORS は発生しない。

`agent-app/infra` には相乗りしない。ADR-0010 がその範囲を「`agentcore.json` に乗らない
**エージェント**リソース」と定義しているため。

## 構成

- `bin/front-door.ts` — エントリポイント。リポジトリルート基準で `nextjs-app/out`・
  `hono-app/src/lambda.ts`・`agent-app` のデプロイ状態ファイルを指す。**外の世界を
  読むのはここだけ**で、スタックは受け取った値だけを見る（テストを固定の
  フィクスチャで回せるようにするため）。
- `lib/front-door-stack.ts` — スタック本体。
- `lib/runtime-arn.ts` — Runtime の ARN を `agent-app` のデプロイ状態ファイルから読む。
- `test/` — synth したテンプレートを検査する単体テスト。実際のビルド成果物や
  `hono-app` の node_modules に依存させないため、`test/fixtures/` を貼る。

## デプロイ

```sh
FORMECHO_BASIC_AUTH_PASSWORD=... mise run deploy:infra   # nextjs-app のビルド → cdk deploy
```

**`cdk deploy` を単体で打たない。** フロントエンドの成果物をアセットとして貼るので、
ビルドを飛ばすと古いものが配信されたままデプロイは成功して見える（一度もビルドして
いない場合だけは synth が止める）。BFF のバンドルにはリポジトリルートの
`pnpm install` も要る。

初回は対象アカウント・リージョン（ap-northeast-1）の `cdk bootstrap` が要る。
`agent-app/infra` を同じ場所へデプロイ済みなら済んでいる。

配信 URL はデプロイ出力の `FrontDoorUrl`。

## BFF（#139）

`hono-app` を Lambda（Node 22 のマネージドランタイム）に載せ、Function URL を同じ
ディストリビューションの `/api/*` behavior に繋いでいる。パスは透過するので
`/api/ai/tasks` はそのまま届き、BFF 側のルーティング改修は0行。

**Function URL は公開 DNS 名を持つが公開エンドポイントではない。** `authType` は
`AWS_IAM` で、CloudFront の OAC が SigV4 で署名する。resource policy は principal を
CloudFront のサービスプリンシパルに、`AWS:SourceArn` をこのディストリビューションに
絞るので、この CloudFront 以外から BFF を叩く経路は無い（署名なしで直接叩くと 403）。

`/api/*` の origin request policy は**ビューアの `Authorization` を転送しない**。OAC が
同じヘッダを自分の署名に差し替えるためで、CDK 既定の `AllViewerExceptHostHeader` は
`Authorization` を含むので使えない。Basic 認証の CloudFront Function もこの behavior に
付いている（静的ファイルだけ守ると Bedrock の課金口が開く）。

Runtime の宛先は環境変数（`FORMECHO_RUNTIME_CLIENT=deployed` と `FORMECHO_RUNTIME_ARN`）。
**ARN は context に手写しせず、`agent-app/agentcore/.cli/deployed-state.json`（`agentcore
deploy` の結果としてコミットされている）から読む。** デプロイ先を張り替えたときに
片方だけ古くなるのを防ぐため。

**OAC 越しの POST は呼び出し側が本文ハッシュを載せる。** Lambda は unsigned payload を
受け付けないので、`nextjs-app/src/lib/api.ts` が `x-amz-content-sha256` を付ける
（ADR-0014）。ここが落ちると front door 越しの AI 機能が丸ごと 403 になる。

`cdk synth` は esbuild で `hono-app/src/lambda.ts` の import グラフをバンドルする。
**リポジトリルートで `pnpm install` を済ませていないと "Could not resolve" で落ちる。**
AWS SDK は外部化せず束ねる（マネージドランタイム同梱の版に依存させない）。

## Basic 認証

CloudFront Function（viewer request）で全リクエストに Basic 認証を要求する（#138）。
BFF 側の認証ミドルウェアは素通しのままで、本番の JWT 検証（GSS / Entra）は
ADR-0014 の範囲外 — ここで守っているのは Bedrock の課金口を無認証で公開しないこと。

利用者名は `formecho` 固定。**パスワードはリポジトリに置かず**、synth 時に CDK の
context `basicAuthPassword` で注入する（`agent-app/infra` が `runtimeRoleArn` を
取っているのと同じ形）。渡さずに synth すると理由の分かるエラーで止まる。

**リポジトリに入れないだけで、秘匿はしていない。** パスワードは Function のコードに
base64 で埋め込まれ、CloudFormation のテンプレート（`cdk.out` と bootstrap バケット、
`GetTemplate`）に平文相当で残る。検証環境の入口を閉じるための共有パスワードとして扱い、
他所で使い回さないこと。
