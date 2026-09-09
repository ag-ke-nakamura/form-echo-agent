# infra

**デプロイ済み検証環境**の front door を持つ CDK アプリ（ADR-0014）。スタックは
`FormEchoFrontDoor` の1つで、現時点では S3（非公開）+ CloudFront + OAC による
フロントエンドの配信と、その手前の Basic 認証を持つ。BFF の Lambda + Function URL
（#139）はこのスタックに足していく。

`agent-app/infra` には相乗りしない。ADR-0010 がその範囲を「`agentcore.json` に乗らない
**エージェント**リソース」と定義しているため。

## 構成

- `bin/front-door.ts` — エントリポイント。リポジトリルート基準で `nextjs-app/out` を指す。
- `lib/front-door-stack.ts` — スタック本体。
- `test/` — synth したテンプレートを検査する単体テスト。実際のビルド成果物に依存させない
  ため、`test/fixtures/frontend-out` を貼る。

## デプロイ

```sh
FORMECHO_BASIC_AUTH_PASSWORD=... mise run deploy   # nextjs-app のビルド → cdk deploy
```

**`cdk deploy` を単体で打たない。** フロントエンドの成果物を貼るだけのスタックなので、
ビルドを飛ばすと古いものが配信されたままデプロイは成功して見える（一度もビルドして
いない場合だけは synth が止める）。

初回は対象アカウント・リージョン（ap-northeast-1）の `cdk bootstrap` が要る。
`agent-app/infra` を同じ場所へデプロイ済みなら済んでいる。

配信 URL はデプロイ出力の `FrontDoorUrl`。

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
