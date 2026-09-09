# デプロイ済み検証環境の front door は参照アーキテクチャと別の載せ方にする

- **Status**: accepted
- **Date**: 2026-09-08

`agent-app` は既に AWS 上で動いている（Runtime・Web 検索の Gateway ともデプロイ済み）が、`hono-app` と `nextjs-app` はローカル起動しかできない。3層すべてを AWS 上に置き、ブラウザから URL を開けば触れる状態にする。

参照アーキテクチャ（ADR-032・共通設計方針書、`docs/architecture.md` §7）は本番の front door を **ALB + ECS Fargate 上の BFF** と定めている。**デプロイ済み検証環境はここに従わず、CloudFront（単一オリジン）+ Lambda Function URL にする。参照アーキテクチャの ALB + ECS Fargate は本番の姿として据え置く。**

決め手は時間予算だった。この検証環境の応答時間の連鎖は Runtime の自己打ち切り55秒（`FORMECHO_AGENT_LOOP_TIMEOUT_MS`、#125）→ BFF 60秒（`FORMECHO_RUNTIME_TIMEOUT_MS`）→ 画面60秒（`REQUEST_TIMEOUT_MS`）で組んであり、**API Gateway（HTTP API / REST API）の統合タイムアウト上限29秒はこの予算に入らない。** 遅い推論が `runtime-client.ts` のエラー写像を素通りして API GW の 504 になり、職員への案内（再送か非AI経路か）が壊れる。Lambda Function URL には29秒の壁が無い。

CONTEXT.md が挙げるこのリポジトリの目的は「プロンプト・Guardrail の精度と本番向けサンプルコード」で、**サンプルコードの対象は `hono-app` の中身であって前段のロードバランサではない。** `index.ts` から `runtime-transport.ts` までのコードは、ALB + ECS でも Function URL でも1行変わらない（変わるのは `src/lambda.ts` 3行の追加だけ）。前段を実測せずに選ぶことで失うものが無い。

## Considered Options

- **ALB + ECS Fargate（参照アーキテクチャ通り。却下）**: 到達点との差分がゼロになるのが唯一の利点。VPC・サブネット・SG・ECR・タスク定義・ALB の月額固定費が付き、**この検証環境が確かめたい対象（Guardrail の精度・プロンプト）を1つも前進させない。** ECS を実測して参照アーキテクチャの結論を裏付けるならそれ自体が別の検証課題であり、この作業単位には入らない
- **API Gateway HTTP API + Lambda（却下）**: 統合タイムアウト29秒がハード制約で、60秒の時間予算を30秒へ下げる改修（3プロジェクトすべての定数と、Runtime の55秒）が付いてくる。**実測で決めた値を、前段の都合で動かすことになる**
- **CloudFront + Lambda Function URL、単一オリジン（採用）**: CloudFront に `/api/*` の behavior を足して BFF へ向ける。CORS が消え、`NEXT_PUBLIC_API_BASE_URL` を空文字にすれば SSG のビルド時に BFF の URL を知らなくて済む（`api.ts` の `?? "http://localhost:8787"` は空文字では発火しないので**フロントのコード改修は0行**）。Basic 認証も静的ファイルと API の両方に1箇所で効く
- **CloudFront + Lambda Function URL、2オリジン（ブラウザから Function URL を直接叩く。却下）**: CloudFront の origin response timeout（既定30秒・設定上限60秒）を回避できるが、Runtime が55秒で自ら打ち切るので**その天井には元から届かない**。代わりに CORS と「BFF をデプロイしないと URL が決まらないのでフロントをビルドできない」順序制約が残る

## Consequences

- **Function URL は公開 DNS 名だが、公開エンドポイントにはしない。** `authType` を `AWS_IAM` にし、CloudFront の OAC が SigV4 で署名する。Function URL の resource policy は principal `cloudfront.amazonaws.com` かつ `AWS:SourceArn` がこのディストリビューションのものだけを許すので、**この CloudFront 以外から叩く経路が閉じる**
- **OAC 越しの POST は本文ハッシュを呼び出し側が載せる。** AWS のドキュメントは「PUT / POST では利用者が本文の SHA256 を計算して `x-amz-content-sha256` に入れて CloudFront へ送る必要がある。Lambda は unsigned payload をサポートしない」と明記している。**したがって上の「フロントのコード改修は0行」は成り立たず、`src/lib/api.ts` が `hc` に渡す `fetch` でこのヘッダを載せる**（#139 で判明）。ローカル開発でも常に載せる — 環境で分岐すると「デプロイ済みでだけ 403」になり手元では気付けない
- **OAC は `Authorization` ヘッダを自分の署名で上書きする。** Basic 認証（CloudFront Function・viewer request）が読むのは同じヘッダなので、origin request policy でビューアの `Authorization` を**転送しない**必要がある。両立するが、片方を足すときにもう片方を壊しやすい組み合わせとして残る
- **`middleware/auth.ts` は素通しのまま。** 本番の JWT 検証を実装する代わりに、CloudFront の手前の Basic 認証で Bedrock の課金口を閉じる。`auth.ts` のコメントが言う「相手が決まっていて検証の余地がない」が有効な間はこれで足り、経路（ミドルウェアの差し込み口）は変わらない
- **応答ストリーミングの余地を1つ手放していない。** BFF は `c.json()` で一括応答なので `handle` + 既定の `BUFFERED` を使うが、将来 Runtime の応答を流すなら `streamHandle` + `invokeMode: RESPONSE_STREAM` に切り替えられる。ALB / API GW を選んだ場合と違い、この切り替えは front door を作り直さずに済む
- **`docs/architecture.md` §7 は「本番想定（未実装）」の隣に「デプロイ済み検証環境（実装）」を並べる形になる。** `next.config.ts` と `src/lib/api.ts` の「ALB 上の BFF」というコメントは偽になるので直す
- **本番へ持っていくとき、front door は作り直しになる。** 持っていけるのは `hono-app` の中身と入出力契約であって、CDK スタックではない。ALB + ECS へ載せ替える判断は本番プロジェクト側で下す
