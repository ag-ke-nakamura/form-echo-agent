# infra

**デプロイ済み検証環境**の front door を持つ CDK アプリ（ADR-0014）。スタックは
`FormEchoFrontDoor` の1つで、現時点では S3（非公開）+ CloudFront + OAC による
フロントエンドの配信だけを持つ。Basic 認証（#138）と BFF の Lambda + Function URL
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
mise run deploy   # nextjs-app のビルド → cdk deploy
```

**`cdk deploy` を単体で打たない。** フロントエンドの成果物を貼るだけのスタックなので、
ビルドを飛ばすと古いものが配信されたままデプロイは成功して見える（一度もビルドして
いない場合だけは synth が止める）。

初回は対象アカウント・リージョン（ap-northeast-1）の `cdk bootstrap` が要る。
`agent-app/infra` を同じ場所へデプロイ済みなら済んでいる。

配信 URL はデプロイ出力の `FrontDoorUrl`。
