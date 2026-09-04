# 参照ドキュメントの修正メモ

`temp/00-arch-design.md`（AI機能 共通設計方針書）と `temp/00-september-ai-agent-infrastructure-design.md`（ADR-032）を検証環境の設計中に読み込んで見つけた、**元ドキュメント側を直すべき箇所**の記録。

`temp/` は `.gitignore` 対象なのでこのメモに集約する。検証で新しい矛盾が出たら追記する。

**凡例** — 影響度: 🔴 設計判断が変わる / 🟡 記述の誤りだが結論は変わらない / 🟢 情報の追記

---

## Bedrock モデルの選定

### 🔴 F-01. ap-northeast-1 では推論プロファイルが必須で、`jp.` 以外は ADR-011 違反

**該当**: ADR-032「構成」（`Bedrock Claude（モデルは実装時に選定）`）、共通設計方針書 4.4節（`"modelId": "実装時に選定"`）、3.3節（`bedrock:InvokeModel`: 特定モデルファミリーに限定）

**事実**（ap-northeast-1 で `ListFoundationModels` / `ListInferenceProfiles` を実行して確認）:

- 現行の Claude モデルはすべて `inferenceTypesSupported: ["INFERENCE_PROFILE"]` のみ。`ON_DEMAND` を持つのは `anthropic.claude-3-haiku-20240307-v1:0`（LEGACY）だけ。**プレフィックスなしのモデルIDは使えない**
- プロファイルの選択肢は3つで、データ主権の観点で結論が分かれる

| プレフィックス | 対象リージョン | ADR-011 |
|---|---|---|
| `jp.` | ap-northeast-1 + ap-northeast-3 | ✅ 国内に閉じる |
| `apac.` | 東京・ソウル・大阪・ムンバイ・シンガポール・シドニー他 | ❌ |
| `global.` | 全世界 | ❌ |

**修正案**: 「実装時に選定」に**制約を明記する** — 「`jp.` プレフィックスの推論プロファイルを使う。`apac.` / `global.` は ADR-011 違反」。ADR-032 が Guardrails Standard Tier を「クロスリージョン推論で APAC 全域に分散。ADR-011 違反のため不採用」として落としたのと同じ基準を、モデル選定にも適用する必要がある。

`jp.` で利用可能な世代: Sonnet 4.5 / Sonnet 4.6 / Haiku 4.5 / Opus 4.7 / Opus 4.8。

---

## Guardrail / 入力検証

### 🔴 F-02. `InvokeGuardrailChecks` のスコアは離散値で、記載のしきい値がバグっている

**該当**: 共通設計方針書 10.4節「Prompt Attack スコア **> 0.8** でブロック」、ADR-032「スコア 0-1」

**事実**: スコアは `{0, 0.2, 0.4, 0.6, 0.8, 1.0}` の6値のみ。連続値ではない。

したがって `> 0.8` は **`== 1.0` と同義**で、0.8 を検知しても素通りする。

**修正案**: `>= 0.8` に直す。あわせて「スコア 0-1」を「離散スコア ∈ {0, 0.2, 0.4, 0.6, 0.8, 1.0}」に改め、しきい値はこの格子上から選ぶ旨を注記する（`>= 0.75` と `>= 0.8` は同一の述語になる）。

出典: <https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-invoke-guardrail-checks-scores.html>

### 🔴 F-03. マイナンバーは `InvokeGuardrailChecks` の検知対象に含まれない

**該当**: ADR-032 機能別比較表「A: InvokeGuardrailChecks / PII 検知（日本語）: ✅ 検証済み」、推奨案の根拠1「Prompt Attack + PII の両方を API レベルでカバー」、共通設計方針書 3.4節・10節（マイナンバーを高機微情報として名指し）

**事実**: `sensitiveInformation` の PII タイプは31種で、すべて米国・英国・カナダ・汎用のもの（`US_SOCIAL_SECURITY_NUMBER`, `UK_NATIONAL_INSURANCE_NUMBER` 等）。**日本の個人番号に対応する型は存在しない。**

ドキュメントが最重要としている高機微情報がマイナンバーであるため、案Aを採用しても 3.4節の正規表現 `/\d{4}-\d{4}-\d{4}/` は**「実装方式が決定するまでの暫定」ではなく恒久的に必要**になる。

**修正案**: 比較表の「PII 検知」を「PII 検知（**日本固有の識別子を除く**）」に改め、推奨案の根拠1から「PII の両方をカバー」という無条件の評価を外す。日本固有 PII の検知手段を別項目として立てる。

### 🟡 F-04. 案Bを落とした理由の立て方が誤っている

**該当**: ADR-032 機能別比較表「B: Classic Tier / Prompt Attack（日本語）: ❌ 英仏西のみ」「Content Filters（日本語）: ❌ 英仏西のみ」、共通設計方針書 3.4節 比較表

**事実**: 「英語・フランス語・スペイン語のみ」は Guardrail の **Tier の性質**で、`ApplyGuardrail` **API の性質ではない**。`ApplyGuardrail` は参照する Guardrail リソースに設定された Tier に従うため、Standard Tier のガードレールを `ApplyGuardrail` から呼べば日本語（Optimized）が使える。

ただし Standard Tier はクロスリージョン推論（ガードレールプロファイル）が必須で、ADR-011 に違反する。

**結論は変わらないが、理由が違う**。「API が日本語に対応していない」ではなく「**日本語に対応する Tier が国内に閉じられない**」。

**修正案**: 表の見出しを「Classic Tier」ではなく「Classic Tier（国内に閉じられる唯一の Tier）」とし、日本語非対応が Tier 由来であることを注記する。

出典: <https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-supported-languages.html>, <https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-tiers.html>

なお PII（sensitive information filters）は Tier による分岐がなく17言語対応で、**日本語は Optimized**。日本語非対応は content filters・prompt attacks・denied topics・word filters に限られる。

### 🟡 F-05. `ApplyGuardrail` の返り値は「Block / Pass / Redact」ではない

**該当**: ADR-032 実装方式の比較表「Classic Tier: チェック結果 = Block / Pass / Redact」

**事実**: トップレベルの `action` は `NONE | GUARDRAIL_INTERVENED`。`assessments[]` の各ポリシー項目が独自の `action` と `detected` を持ち、content filters は数値スコアではなく**カテゴリ値**（`confidence` / `filterStrength`）を返す。

**修正案**: 表の記述を実際のレスポンス構造に合わせる。「Detect-only（スコア 0-1）」との対比を書きたいなら、「数値スコア」対「カテゴリ判定 + 介入フラグ」とするのが正確。

### 🟡 F-06. 日本語のスコア低下は `contentFilter` に固有

**該当**: ADR-032 機能別比較表「A: InvokeGuardrailChecks / Content Filters（日本語）: ⚠️ スコア低め」

**事実**: 独立した2つの実測（ap-northeast-1）が一致した。

| チェック | 日本語の劣化 | 実測 |
|---|---|---|
| `promptAttack` | **なし** | JAILBREAK 1.0 / PROMPT_LEAKAGE 0.8〜1.0。参考記事も「今回のテストでは英語と同等」 |
| `sensitiveInformation` | **なし** | EMAIL 1.0 / PHONE 0.8 / NAME 1.0 / ADDRESS 1.0 |
| `contentFilter` | **あり（穏当な表現で顕著）** | 「あなたみたいな人は尊敬に値しない」→ INSULTS 0.20 / 英語同義文 → 0.60。露骨な表現では日本語でも HATE 1.0 |

**修正案**: 「スコア低め」という一括の評価をやめ、種別ごとに書き分ける。しきい値も種別ごとに設定する必要がある旨を追記する（`contentFilter` は 0.2 まで下げないと穏当な日本語を拾えず、0.2 でブロックすると誤検知が実用に耐えない）。

出典: <https://dev.classmethod.jp/articles/amazon-bedrock-invoke-guardrail-checks-api/>

### 🟢 F-07. `InvokeGuardrailChecks` に存在しないチェックがある

**該当**: 共通設計方針書 10.4節（`Content Filters スコア > 閾値（要調整）でブロック` のみ言及）

**事実**: `InvokeGuardrailChecks` のチェックは3種（`contentFilter` / `promptAttack` / `sensitiveInformation`）のみ。**denied topics・word filter・contextual grounding・automated reasoning・カスタム正規表現はすべて存在せず**、`ApplyGuardrail`（Guardrail リソース）専用。

一方で `promptAttack` は独立したチェックとして `JAILBREAK` / `PROMPT_INJECTION` / `PROMPT_LEAKAGE` のカテゴリ別に返るため、この点は `ApplyGuardrail`（prompt attack が content filters の中に埋まっている）より優れている。

**修正案**: 案Aを選ぶと失う機能を明記する。特にカスタム正規表現が使えないことは F-03（マイナンバー）に直結する。

### 🟢 F-08. `InvokeGuardrailChecks` の前提条件が書かれていない

**該当**: ADR-032 参考資料、共通設計方針書 3.4節

**事実**:

- API は `bedrock-runtime` サービス（コントロールプレーンの `bedrock` ではない）。IAM アクションは `bedrock:InvokeGuardrailChecks`
- **リソースレスなので IAM ポリシーは `"Resource": "*"` になる**。スコープは条件キー（`aws:SourceIp`, `aws:PrincipalTag`）や SCP で絞る
- JS SDK は `@aws-sdk/client-bedrock-runtime` の `InvokeGuardrailChecksCommand`。**3.1069.0 以降**（3.1068.0 には存在しない）
- 対応リージョンは7つ（us-east-1, us-east-2, us-west-2, eu-west-2, eu-north-1, **ap-northeast-1**, ap-southeast-2）。クォータ 1,500 RPM/アカウント/リージョン
- **サポート外リージョンでは `AccessDeniedException: Your account is not authorized to invoke this API operation` が返る**（`ap-northeast-3`, `eu-central-1` で確認）。IAM の問題と誤診しやすい

**修正案**: 3.3節の IAM 権限一覧に `bedrock:InvokeGuardrailChecks` を追加し、`Resource: "*"` になる理由と代替のスコープ手段を注記する。SDK の最低バージョンと、サポート外リージョンのエラー形も残す。

---

## エージェント構成

### 🔴 F-09. `taskId` が Skill を決めるのか、エージェントが選ぶのかが矛盾している

**該当**: 共通設計方針書 14.2節の表 vs ADR-032 論点4

**矛盾**:

- 14.2節の表は `taskId` と Skill を**1:1 で対応させている**（`meeting.parse-candidates` → `skills/meeting/parse-candidates/SKILL.md`）
- ADR-032 論点4は「Skill の選択: 各エージェントが user prompt を見て、自分のドメイン内の適切な Skill を**エージェンティックに選択（if-else ではない）**」

`taskId` が Skill を決めているなら、エージェントに選ぶ余地はない。逆にエージェントが選ぶなら `taskId` は `meeting` までしか必要ない。

**実務上の論点**: `parse-candidates`（候補日程を立てる）と `parse-availability`（参加可否を答える）は**別の画面から呼ばれる**。画面はどちらか知っているので、本番設計としては AI に推測させる方が明確に劣る。ADR-032 論点4はこの4機能に対しては筋が悪い可能性がある。

**修正案**: 検証環境で両モードの Skill 選択的中率を実測してから、どちらかに寄せる。実測結果をこのメモに追記する。

### 🟢 F-10. Strands の TypeScript SDK での対応状況が書かれていない

**該当**: 共通設計方針書 2.2節（Strands のリンクのみ）、ADR-032 論点4

**事実**（`@strands-agents/sdk` 1.5.0 の型定義で実在を確認）: 参照ドキュメントが前提としている機能は**すべて TypeScript SDK に存在する**（Python 専用ではない）。

| 機能 | API |
|---|---|
| Structured Output | `new Agent({ structuredOutputSchema })` / `agent.invoke(p, { structuredOutputSchema })`。**Zod スキーマをそのまま渡す**。結果は `AgentResult.structuredOutput` |
| Skills | `AgentSkills` クラス（`@strands-agents/sdk/vended-plugins/skills`）を `plugins: []` に渡す。`skills` は**TS では常に配列** |
| エージェント間ルーティング | agent-as-tool（`Agent` を別 Agent の `tools` に渡す）、`asTool()`、`Graph`、`Swarm` |
| 会話履歴 | `conversationManager`（既定 `SlidingWindowConversationManager`）、永続化は `SessionManager` + `FileStorage` / `S3Storage` |
| Guardrails | `new BedrockModel({ guardrailConfig: { guardrailIdentifier, guardrailVersion, ... } })` |

**注意点2つ**:

1. Structured Output の検証済みオブジェクトは**最終イベント `agentResultEvent` に載って届く**。テキストを逐次ストリームする実装とは噛み合わない
2. `AgentSkills` は `SKILL.md` の付随ファイル（`scripts/` `references/` `assets/`）を**自分では読まない**。activate 時にファイル一覧を返すだけで、中身を読むには `bash` / `fileEditor` ツールを別途渡す必要がある。さらに frontmatter の `allowed-tools` は**情報提供のみで強制力がない**

**修正案**: 2.2節に TS SDK の該当 API 名を明記する。特に注意点2は、ガバメントクラウド前提で Runtime に `bash` を渡すかという統制の論点になるため 3節にも反映する。

---

## CLI・インフラ

### 🔴 F-11. `agentcore.json` の設定例が現行スキーマと全く違う

**該当**: 共通設計方針書 4.4節「Runtime 設定例（agentcore.json）」

**事実**: 例では `runtimes` が**オブジェクト**（キーが Runtime 名）で、`container` / `model` / `guardrail` / `environment` フィールドを持つ。

現行スキーマ（`agentcore/.llm-context/agentcore.ts` の `AgentCoreProjectSpec`）では:

- `runtimes` は**配列**
- 各要素のフィールドは `name` / `build` / `entrypoint` / `codeLocation` / `runtimeVersion` / `networkMode` / `protocol`
- **`model` / `guardrail` / `environment` フィールドは存在しない**

つまり例に書かれた形では `agentcore validate` を通らない。モデルIDと Guardrail の指定は**エージェントのコード側**で行う（`BedrockModel` のコンストラクタ）。

**修正案**: 4.4節の例を実際のスキーマに差し替える。あわせて「モデルIDと Guardrail は agentcore.json では宣言できず、コード側で指定する」旨を明記する。

### 🟡 F-12. CLI コマンド名が実在しない

**該当**: 共通設計方針書 4.4節「CLI 駆動デプロイ」

**事実**: `agentcore init --name ... --type runtime` は CLI のコマンド一覧に存在しない。プロジェクト作成は **`agentcore create`**。

**修正案**: `agentcore create` に直す。`agentcore add agent --type create` の `--type` の値も実際のヘルプで確認する。

### 🟢 F-13. Runtime の入力検証を宣言的に張る経路は存在しない

**該当**: ADR-032「AgentCore 構成要素の利用範囲」表、共通設計方針書 3.5節・3.6節

**事実**: `agentcore.json` の `policyEngines` / `policies` は **Cedar 文のみ**（`Policy.statement: string`）で、参照元は **Gateway**（`GatewayPolicyEngineConfiguration`）。Runtime のモデル入力に対して宣言的にガードレールを張る経路はない。

CLI の生成物 `agent-app/AGENTS.md` は「form-based guardrails (Bedrock content filters, prompt-attack, sensitive-info)」と説明しているが、**現行スキーマの `Policy` 型にその形は無い**（CLI 側のドキュメントバグ）。

**修正案**: 3.6節の実行制限（`maxIterations` / `maxTokens` / `timeoutSeconds`）が `agentcore.json` で宣言できるのかを実機で確認する。現行スキーマの `runtimes` 要素にこれらのフィールドは見当たらない。宣言できないならコード側の責務として書き直す。

### 🟢 F-24. Gateway と Web Search コネクタは `agentcore.json` に宣言できる（#46 で確認）

**該当**: #46 の「要確認」（CLI 直叩きではなく宣言的に張れる可能性）

**事実**: 張れる。**スクリプトは要らなかった**（Guardrail リソースの F-11 と違う）。

```bash
agentcore add gateway --name FormEchoWebSearch --protocol-type MCP --authorizer-type AWS_IAM
agentcore add gateway-target --name WebSearch --gateway FormEchoWebSearch \
  --type connector --connector web-search
```

ただし**生成物の2つが食い違っている**。`agent-app/AGENTS.md` は `GatewayTargetType` に `'connector' (web-search, bedrock-knowledge-bases)` を挙げるが、同じ CLI が置く `agentcore/.llm-context/agentcore.ts` の `GatewayTargetType` に `'connector'` は無く、代わりに `'httpRuntime'` がある。**CLI 本体（`agentcore add gateway-target --help`）は `connector` を受け付ける**ので、遅れているのは `.llm-context` の型定義のほう。スキーマファイルだけを見て「宣言できない」と判断すると誤る。

`agentcore.json` に書かれる形は次のとおり（`targets[].connectorId` と `configurations[]` は `.llm-context` の `AgentCoreGatewayTarget` に無いフィールド）。

```json
{
  "name": "FormEchoWebSearch",
  "protocolType": "MCP",
  "authorizerType": "AWS_IAM",
  "targets": [
    { "name": "WebSearch", "targetType": "connector", "connectorId": "web-search",
      "configurations": [{ "name": "WebSearch", "parameterValues": {}, "parameterOverrides": [] }] }
  ]
}
```

**Gateway に渡る権限は1アクション・1リソースに閉じる**（ツール統制、10節の観点）。CDK が生成する Gateway ロールのインラインポリシーは以下だけで、Runtime の実行ロールとは別物である。

```json
{ "Effect": "Allow",
  "Action": "bedrock-agentcore:InvokeWebSearch",
  "Resource": "arn:aws:bedrock-agentcore:ap-northeast-1:aws:tool/web-search.v1" }
```

**ADR-011（データ主権）の確認 — 構成からの推論であって、通信の観測ではない。** 確かめたのは次の3点で、いずれも**リージョンが識別子に焼き込まれている**ことである。

- Gateway ロールが許すリソース: `arn:aws:bedrock-agentcore:ap-northeast-1:aws:tool/web-search.v1`
- Gateway 本体: `arn:aws:bedrock-agentcore:ap-northeast-1:<account>:gateway/...`
- MCP エンドポイント: `https://<id>.gateway.bedrock-agentcore.ap-northeast-1.amazonaws.com/mcp`

Runtime 側も取り違えを起動時に落とす（`config.ts` の `resolveWebSearchGatewayUrl` がホスト名のリージョンを検査する）。

**ただし「検索クエリと結果が ap-northeast-1 に閉じる」は証明できていない。** 上の3点が言うのは *我々が ap-northeast-1 のエンドポイントにしか話しかけない* ことまでで、**コネクタがその先で検索事業者へどう出ていくかは観測していない。** 7.1節の「Web Search は strictly regional」は構成と矛盾しないが、裏付けるには CloudTrail のデータイベントか AWS への確認が要る。**本番設計へ持っていくなら、ここは申し送りになる。**

呼ぶ側（Runtime）に要るのは Gateway を叩く権限だけで、**Web 検索そのものの権限は持たない。**

### 🔴 F-27. Web Search Tool の「許容される利用方法」が出典の表示を義務づけている

**該当**: 共通設計方針書 7.1節（Websearch の利用）。**参照ドキュメントはこの制約に触れていない。**

**事実**: [Web Search Tool のドキュメント](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-connector-web-search-tool.html#gateway-target-connector-web-search-tool-acceptable-use)の Acceptable use が次を課している。

> You must retain and display the source citations and links provided with each Search Result **in any output you surface to your end users that uses the Search Result**. You may not use Web Search Tool to (a) extract, store, or reproduce content from Search Results in bulk, or (b) build or populate a competing index or database.

つまり `sources` の表示は**透明性のための設計判断ではなく、利用条件そのもの**である。#46 の受け入れ条件は `sources`（AI が申告した URL）を画面に出すことを求めていたが、**それだけでは条件を満たさない。** 理由は2つ。

1. **出典（citation）を落としていた。** 求められているのは citation と link の**両方**で、Search Result には `title` が付いてくる。ホスト名だけのリンクでは出典を表示したことにならない
2. **表示がモデルの申告頼みだった。** `sources` はモデルが「根拠にした」と書いた URL で、**使ったのに載せない**ことも、検索結果に無い URL を混ぜることもある。実測でも、モデルが申告したのは2件だが Runtime が取得して渡したのは5件だった。申告漏れの分は、出典なしで検索結果由来の回答を職員に見せることになる

**対応**: Runtime が実際に取得した Search Result の出典を、AI の出力とは別に応答へ載せた（`AiTaskSuccessResponse.citations`）。画面はこちらを表示の正典にする。**遵守をモデルの協力に依存させない。**

- Runtime — `citations` に `{title, url, publishedDate?}` を載せる。**本文（`text`）は載せない**（bulk での抽出・保存・複製の禁止に触れないため、かつ表示に要らないため）。URL で重複を落とす
- BFF — 契約で検査して通す。**壊れた出典は黙って落とさず `PARSE_FAILED` にする**（落とすと、規約に反したまま画面が成功として描く）
- 画面 — 出典・リンク・ホスト名・公開日を並べる。`sources` は AI の出力契約に残るが、**リンクの表示はもう `sources` から導かない**

**修正案**: 7.1節に利用条件として明記する。「`sources` を画面に出す」を透明性の推奨ではなく**必須**として書き、表示の根拠を AI の出力ではなく実際の検索結果に置くこと。**本番設計でも同じ制約が掛かる。**

**あわせて公開日の形が2つある。** ドキュメントの Response format の例は `2024-10-07` だが、実物は `05:00PM, Thursday, August 27 2026, PDT` の形でも返る（`new Date()` が解釈できない）。分からないときは `unknown` という文字列が入る。

### 🟡 F-25. CLI 0.28.1 と `@aws/agentcore-cdk` alpha.51 は `deploy` で衝突する（#46 で発覚）

**該当**: `.claude/rules/agentcore-cdk.md`（alpha.51 への固定）

**事実**: `agentcore deploy` はバージョンゲートを持ち、`@aws/agentcore-cdk` が CLI の期待（0.28.1 は alpha.50）より新しいと `CliVersionTooOldError` で止まる。**`validate` と `cdk synth` は通るので、`deploy` を実行するまで気付けない。**

```
This project requires a newer version of the AgentCore CLI:
@aws/agentcore-cdk (0.1.0-alpha.51, CLI expects 0.1.0-alpha.50)
```

エラーが案内する `npm install -g @aws/agentcore@latest` は**効かない — 0.28.1 が最新**である。

alpha.51 に固定していたのは alpha.49 の `connectorName` → `connector` 変更で生成コードの build が壊れたためだが、**alpha.50 でも build は通る**ことを確認した（`npm run build` / `cdk synth` / `deploy` すべて成功）。壊れているのは alpha.49 以前だけだった。

**対応**: 固定を alpha.50 へ下げた。もう一方の逃げ道は `agentcore config disableDependencyManagement true`（CLI のグローバル設定）で、こちらは CLI が未検証の組み合わせで deploy することになる。

**あわせて CLI が `agentcore/cdk/package.json` の他の依存も書き換えた**（キャレット→チルダ、`@types/node` は 22 系から 24 系へ）。**#46 が意図した変更ではなく、`agentcore deploy` の副作用である。** 生成物のディレクトリなので差し戻しても次の deploy で戻る。詳細と受け入れた理由は `.claude/rules/agentcore-cdk.md`。

### 🟡 F-26. Runtime の CodeZip バンドルが `contracts/` の symlink 越しに `zod` を解決できない

**該当**: `.claude/rules/agent-app.md`「`agentcore package` は CLI 0.28.1 のバグで失敗する」

**事実**: 症状が変わっている。**esbuild がバイナリを見つけられないのではなく、`zod` を解決できない。**

```
✘ [ERROR] Could not resolve "zod"   ../../../contracts/api.ts:1:18
（fields.ts / inputs.ts / outputs.ts も同じ）
```

esbuild は symlink を実体のパスへ解決するため、`contracts/` からは `node_modules` を辿れない（`vitest.config.mts` と `nextjs-app` が別名で回避しているのと同じ事情。ADR-0002 と `.claude/rules/contracts.md`）。tsconfig の `paths` にある `"zod"` は CDK の esbuild 呼び出しには効かない。

**Gateway のデプロイはこれに阻まれない。** 1つのスタックだが、`runtimes` を空にすれば CodeZip のバンドルが走らず synth が通る。#46 ではその形で Gateway だけを deploy した（Runtime は未デプロイのまま）。

**Runtime を実際にデプロイするときに解く必要がある。** `contracts/node_modules` を Runtime の `node_modules` への symlink にすると synth は通ることを確認したが、`nextjs-app` / `hono-app` のバンドラが `contracts/` 経由で agent-app の `zod` を引く経路ができるため、副作用の評価が要る。

---

## Guardrail（Classic Tier / アカウントレベル適用の調査で追加）

### 🔴 F-14. BLOCK は会話履歴に残ると連鎖ブロックし、11.2節の「3回連続」と誤認される

**該当**: 共通設計方針書 11.2節「3回連続ブロックで手動入力へフォールバック」、8節（Runtime 内部メモリで会話履歴を8時間保持）

**事実**: ブロック対象のテキストが一度会話履歴に入ると、**以降の正常なメッセージまでブロックされ続ける**（回復にはセッション再起動が必要）。

参照アーキは複数回やり取りを前提にしているため、1回のブロックが「3回連続ブロック」を自動的に成立させてしまう。ユーザーが正しく直しても通らない。

**修正案**: BLOCK ではなく ANONYMIZE を既定にする、またはブロック時点でセッションを破棄して新しい `runtimeSessionId` を発行する運用を 11.2節に明記する。「3回連続」の判定は、連鎖ブロックと真の再ブロックを区別できる形にする必要がある。

出典: <https://dev.classmethod.jp/articles/bedrock-account-level-enforcement-guardrail-claude-code/>

### 🔴 F-15. Classic Tier でも PII は日本語対応。日本語非対応は content filters 側だけ

**該当**: F-04 の精緻化。ADR-032 機能別比較表

**事実**: 言語サポートの分岐は**ポリシー種別ごとに違う**。

| ポリシー | Classic Tier | 日本語 |
|---|---|---|
| content filters / prompt attacks | 英仏西のみ | ❌ |
| denied topics | 英仏西のみ | ❌ |
| word filters | 英仏西のみ（Tier 分岐なし）。**完全一致の文字列のみでパターン構文なし**（1エントリ3語まで、上限10,000件） | ❌ |
| **sensitive information filters** | **Tier 分岐なし・17言語** | ✅ **Optimized and supported** |
| contextual grounding | 英仏西のみ | ❌ |

つまり**案B（Classic Tier）でも PII 検知は日本語で機能する**。ADR-032 の比較表が案Bの「PII 検知（日本語）✅ 93.3% 精度」としているのは正しく、Prompt Attack / Content Filters だけが落ちる。

### 🔴 F-16. カスタム正規表現は使えるが、Structured Output の出力を検査できない

**該当**: F-03 の続き。共通設計方針書 6節（Structured Output）、10節「AI非送信データ」

**事実（マイナンバー検知が可能になる側）**: Guardrail リソースの `sensitiveInformationPolicyConfig.regexesConfig[]` にカスタム正規表現を定義できる。**Tier 非依存なので Classic Tier でも使える。**

| 項目 | 値 |
|---|---|
| フィールド | `CreateGuardrail` / `UpdateGuardrail` → `sensitiveInformationPolicyConfig.regexesConfig[]` |
| サブフィールド | `name`（1-100字）、`pattern`（1-500字）、`action`、`inputAction` / `inputEnabled` / `outputAction` / `outputEnabled` |
| アクション | `BLOCK` / `ANONYMIZE` / `NONE` |
| 上限 | **30パターン/ガードレール/リージョン**、パターン長 **500字** |
| 制約 | **lookaround（`(?=)` / `(?<=)`）は非対応** |

検知結果は `assessments[].sensitiveInformationPolicy.regexes[]` に `{action, detected, match, name, regex}` として出る。

**事実（穴の側）**: sensitive information filter は**ツール関連フィールドを評価しない** — `toolUse.input`、`toolResult`、`toolSpec.description` / `inputSchema`。

これがこの設計に直接刺さる。**Strands の Structured Output はスキーマをツール仕様に変換して実装されている**ため、モデルが返す構造化データは `toolUse.input` として流れる。つまり:

- **入力側**（ユーザーの自然文）→ 正規表現が見る ✅
- **出力側**（抽出されたフィールドにマイナンバーが載った場合）→ 正規表現が**見ない** ❌

**修正案**: 10節「AI非送信データ」の統制を「入力検証でブロック」だけで完結させず、出力側の検査を**アプリケーション層（Structured Output のパース直後）で行う**旨を明記する。Guardrail に出力検査を任せられない。

### 🟡 F-17. アカウントレベル適用は同一アカウントの全 Bedrock 呼び出しを巻き込む

**該当**: 新規（ADR-032 が検討していない選択肢）

**事実**: `guardrailIdentifier` をリクエストで渡さずにアカウント単位で Guardrail を強制適用できる。

| 項目 | 値 |
|---|---|
| 正式名称 | Account-level enforcement configuration |
| API | `PutEnforcedGuardrailConfiguration` / `ListEnforcedGuardrailsConfiguration` / `DeleteEnforcedGuardrailConfiguration`（コントロールプレーン `bedrock`） |
| 傍受対象 | `InvokeModel` / `InvokeModelWithResponseStream` / `Converse` / `ConverseStream` |
| リクエスト形 | `guardrailInferenceConfig: { guardrailIdentifier, guardrailVersion, modelEnforcement: {includedModels[], excludedModels[]}, selectiveContentGuarding: {system, messages} }` |
| バージョン | **数値バージョン必須**（DRAFT 不可） |
| リージョン | リージョンごとに設定。1アカウント1リージョンにつき1つ。ap-northeast-1 対応済み |
| Tier | Classic Tier 互換。**Automated Reasoning のみ非対応**（含めると実行時に失敗） |

Strands の `BedrockModel` は Converse 系を呼ぶので、**Runtime のコードを変更せずに Guardrail がかかる**。

**★ 運用上の危険**: 有効化すると、そのガードレールに対する `bedrock:ApplyGuardrail` 権限を持たない**すべての Bedrock 呼び出し元が `AccessDenied` で失敗する**。AgentCore の実行ロールに権限を付与してから有効化する必要がある。組織レベル・アカウントレベル・リクエスト単位のガードレールは**和集合**として適用され、最も制限の強いものが勝つ。

**修正案**: ADR-032 の「検討した選択肢」にこの経路を追加する。コード変更が不要な反面、アカウント全体に影響するため、共用アカウントでの採用は慎重に判断する旨を明記する。

### 🟢 F-18. `outputScope: FULL` は正規表現とワードフィルターに効かない

**該当**: 共通設計方針書 10.4節「検知詳細（`type`, `match`）をログに記録」

**事実**: `ApplyGuardrail` の `outputScope` に `FULL` を指定しても、**word filters と sensitive information filters の正規表現には適用されない**。介入が起きた行しか返らないため、「検知しなかった」ケースのデバッグ行が取れない。

**修正案**: 精度評価（12節）で正規表現の取りこぼしを測るには、`ApplyGuardrail` のレスポンスではなく**アプリケーション層で同じ正規表現を回して比較する**必要がある旨を追記する。

### 🟢 F-19. マスキングはモデル呼び出しログに適用されず、trace は原文を返す

**該当**: 共通設計方針書 3.4節「CloudWatch Logs のセキュリティ: KMS 暗号化必須」、3.7節

**事実**: ANONYMIZE でマスクしても、**モデル呼び出しログ（CloudWatch の `input`）には生のリクエストが残る**。また trace の `match` フィールドは**マスク前の原文**を返す。

**修正案**: 「KMS 暗号化必須」の理由として、マスキングがログには及ばないことを明記する。1.2節の監査ログ要件「入力テキスト（PII 除外）」は、Guardrail のマスキングでは達成されないため、アプリケーション層で除外する必要がある。

### 🟢 F-20. Standard Tier のクロスリージョン先が具体的に判明

**該当**: F-04 / ADR-032「D: Standard Tier（不採用確定）」の根拠の具体化

**事実**: Classic Tier はクロスリージョン推論が「Not supported」で、`crossRegionConfig` を省略すれば ap-northeast-1 内で評価される。

Standard Tier は `crossRegionConfig.guardrailProfileIdentifier` が必須で、**ap-northeast-1 をソースとする唯一のプロファイル `apac.guardrail.v1:0` の宛先は ap-south-1（ムンバイ）/ ap-northeast-3 / ap-northeast-2（ソウル）/ ap-southeast-1（シンガポール）/ ap-southeast-2（シドニー）/ ap-northeast-1** の6つ。**6つのうち4つが国外。**

なお ap-northeast-3 はどのガードレールプロファイルの**ソースリージョンにもなれず**、safeguard tier のサポートリージョン一覧にも大阪は無い（東京はある）。

**修正案**: 「APAC 全域に分散」を具体的な宛先リージョン名で置き換える。ADR-011 違反の判断根拠が明確になる。

---

## 出力契約（MVP 実装で追加）

### 🟡 F-21. 日付を ISO8601 の日時にする必要がなく、タイムゾーンを許すと日がずれる

**該当**: 共通設計方針書 1.3節（レスポンス例の `"departure_date": "2026-10-15T00:00:00Z"`）、6.2節（`departure_date: string | null; // ISO8601`）

**事実**（MVP 実装で確認）:

- この値の消費側はフォームの日付欄（`<input type="date">`）しかなく、**時刻もタイムゾーンも捨てている**。`YYYY-MM-DD` しか受け取らないので、実装は `slice(0, 10)` で切っていた
- 型が `string` のままだと「来月15日」のような**未解決の文字列が契約を通る**。`<input type="date">` はそれを描画できず黙って空欄になり、値と「AI が生成」バッジだけが残る。何が起きたか画面からも API からも分からない
- 精度を日時まで上げると、モデルがオフセット付き（`2026-10-15T00:00:00+09:00`）を返す余地が生まれる。文字列として切っている限り顕在化しないが、`new Date(iso).toISOString().slice(0, 10)` を一度でも挟むと **`2026-10-14` になり1日ずれる**
- そもそも「出張の出発日」は日付であって時点ではない。時刻の情報源が入力に無い

**修正案**: 6.2節の型を `YYYY-MM-DD`（ISO8601 の暦日付形式）に変え、スキーマ側で形式を強制する。1.3節のレスポンス例も `"2026-10-15"` に直す。「ISO8601」とだけ書くと日時形式に読まれるため、暦日付であることを明示する。

厳しさの軸は2つあり、混同しないこと。**未解決の文字列を弾くこと**は出力契約の役目として要る（弾けないと上記の無音の空欄になる）。**精度を日時まで上げること**は何も買わず、モデルが正しく出すべきものを増やし、日ずれの余地を残す。

**追記（#68）**: 交通ICの2欄については、この結論の後半が**反転した**。画面デザイン設計がこの欄を「出張の出発日」ではなく「ICカードを借りる日時・返す日時」と定めており（`temp/design/reservation-ai-screen-design.md` 2.2節）、**貸出・返却は時点であって日付ではない**。欄が指す対象そのものが変わったので、「時刻の情報源が入力に無い」という前提も成り立たなくなった。契約は `borrow_at` / `return_at` として `YYYY-MM-DDTHH:mm` を要求する（`contracts/fields.ts` の `isoDateTimeSchema`）。

**前半は生きている。** タイムゾーンも秒も持たせない — 消費側が `<input type="datetime-local">` である以上、`+09:00` や `Z` は上記と同じ無音の空欄を作る。日付だけを扱う会議ロジの候補日程（`isoDateSchema`）もこの節の結論のままである。

---

## ツール利用方針

### 🔴 F-22. Websearch を必要とするのは交通ICだけで、会議ロジの2機能は挙げるべきでない

**該当**: 共通設計方針書 7.1節「9月スコープでの利用」、14.2節「機能別の詳細」の Websearch 列

**事実**（AI開発担当への確認による）:

2箇所が交通IC以外も Websearch の利用機能として挙げているが、実際に必要なのは #977 のみ。

| 機能 | 7.1節の記載 | 14.2節の記載 | 実際 |
| --- | --- | --- | --- |
| #977 交通IC経路探索 | 交通経路検索 | ○（交通経路） | **必要** |
| #979 候補日程設定 | 会議室空き状況の確認（将来） | △（将来） | **不要** |
| #980 参加可否回答 | 記載なし | × | **不要** |
| #981 候補日提案 | 参加者の勤務地・交通アクセス情報 | ○（交通アクセス） | **不要** |

**Websearch を入れる目的は AI の回答（経路探索）そのものの精度であって、`sources` を埋めることではない。** 経路・所要時間・列車名をモデルの内部知識だけで答えさせると、情報が古かったり存在しない便を答えたりする。検索で裏を取ることが要件になるのは、この性質を持つ交通ICだけ。`sources` は精度を担保した結果として付いてくる透明性の仕組みである。

会議ロジ側の3機能は自然文の解釈と候補の生成であり、外部の最新情報を必要としない。#979 には両節とも「将来」と付いているが、#981 は両節とも無条件に挙げられている。

**修正案**: 7.1節の一覧を #977 のみに絞り、Websearch が要る理由（**回答精度**を内部知識で担保できない）を書く。#979 と #981 の行は落とす。14.2節の Websearch 列は #981 を `○（交通アクセス）` から `×` に、#979 を `△（将来）` から `×` に直す。

**実装への影響**: Gateway を渡すのは交通ICドメインエージェントだけでよい。会議ロジドメインエージェントに MCP クライアントを渡す必要はなく、その分ツール統制（10節）の面も軽くなる。この判断は #25 に反映済み。

#### 実測: Websearch 有効／無効の経路回答（#46、2026-09-04）

**本検証環境で実施すると判断した。** Web Search コネクタは ap-northeast-1 で利用でき（2026-08-14 対応）、`agentcore.json` に宣言して `agentcore deploy` で張れたので、本番設計への申し送りにする理由が無くなった。#23 の Out of Scope の記述はこの判断で更新した。

同じ入力5件を、**設定だけを変えて**（`FORMECHO_WEB_SEARCH_GATEWAY_URL` の有無）両モードに通した。モデルは `jp.anthropic.claude-sonnet-4-6`。再現手順は `agent-app/app/FormEchoAgent/tests/measure-web-search.ts`。**#23 の方針に従い合否判定は持たず、観測した数字だけを置く。**

| 入力 | 無効: 所要時間 | 有効: 所要時間 | 有効: 便の名指し | 検索回数 / `sources` |
| --- | --- | --- | --- | --- |
| 東京→大阪 | 約2時間30分 | 2時間27分〜2時間30分 | のぞみ135号・38号・42号 | 1回 / 2件 |
| 東京→博多 | 約4時間45分〜5時間 | 約4時間52分〜5時間3分 | なし（種別のみ） | 1回 / 1件 |
| 名古屋→仙台 | 約1時間40分＋約1時間30〜40分＝**3時間30分〜4時間** | **約3時間15分** | なし（種別のみ） | 1回 / 1件 |
| 大阪出張（経路を尋ねない） | なし | なし | なし | **0回 / 0件** |
| 東京→札幌（直通なし） | 直通なしと回答 | 直通なしと回答＋検索でも確認できずと明示 | なし | 1回 / 2件 |

##### 「検索結果に無い列車名を答えていない」の確認方法

**答えと、その往復でモデルが実際に読んだ本文とを突き合わせた**（`webSearchHits` を invocation 境界から返して照合する）。後から同じクエリを投げ直す方法は採らない — 検索結果は毎回同じではないので、突き合わせにならない。

**号数まで名指しした便だけを対象にする。** 「のぞみ号」は列車の**種別**であって特定の便ではなく、路線の常識なので裏取りの対象にしない。裏取りが要るのは「のぞみ135号（09:00発）」のように**職員が実際に乗ろうとする便**を名指ししたときである。

結果: **有効側が名指しした3便（のぞみ135号・38号・42号）はすべて、その往復で読んだ本文に実在した。裏取れなかった便は0件。** 無効側は号数を1つも名指ししなかった（種別までしか言わない）。

##### 観測できたこと

- **無効側の誤差は号数ではなく所要時間に出る。** 名古屋→仙台の「合計3時間30分〜4時間」は有効側の3時間15分と **15〜45分**、東京→博多の「約4時間45分〜5時間」は「約4時間52分〜5時間3分」と **数分**ずれる。乗り換えを跨ぐ経路ほど開く。
- **無効側は検索していないのに検索したと書く。** 東京→博多で「検索で確認できた情報をお伝えします」、東京→大阪で「ウェブ検索では確認できませんでした」。**Web 検索ツールを1つも持っていない状態での発言である。** あわせて `message` の本文に URL を書く（`https://www.jr-odekake.net/` 等）。**`sources` は空配列のままなので画面にリンクは出ないが、文面の中の URL は素通しで職員に届く。** 経路の数字とは別の失敗として数える。
- **切り詰めの上限が裏取りの穴になっていた。** 検索結果の本文を800字で切っていたときは、時刻表ページ（1件 2,300 字前後）から号数と発着時刻の対が3分の1しか渡らず（35件 → 12件、39件 → 13件）、モデルは「表は見たが希望の時間帯の便が無い」状態から号数を補っていた。**上限を3,000字に上げたところ、名指しした便がすべて本文に実在する状態になった。** 節約のつもりの切り詰めが精度を落としていた。
- **検索回数は最大2回で、上限の3回に達しなかった。** 経路を尋ねない入力では0回・`sources` も空配列のままで、「検索を使わなかったときは何も出さない」がそのまま観測できた。
- **有効側はトークンが約3〜4.5倍**（3.6k〜3.8k → 10.4k〜16.5k）、応答は約1.3〜1.8倍の時間になる。上限を3,000字へ上げた分も含んだ数字である。
- **run 間のばらつきは無効側に大きい。** 同じ入力・同じ設定で3回まわしたところ、無効側の名古屋→仙台は「答えない」回と「合わない数字を答える」回の両方が出た。有効側は所要時間の値が安定していた。

**Gateway が落ちているとき**（到達しない URL を渡して確認）も、6項目の抽出はすべて返った。`sources` は空のまま、`message` は「検索結果が取得できなかったためお答えできません」と書いて所要時間を作文しなかった。検索は精度を上げるためのもので、フォームを埋める経路を止めない。

**この節の結論は「Websearch を入れると経路の数字と便名が検索結果に紐づく」までで、精度の合否は判定していない。** 残る穴は無効側の「検索したと書く」振る舞いで、これは Websearch では消えない（**有効側でも、検索が失敗した往復で同じことが起きうる**）。

---

## 出力契約（会議ロジの設計で追加）

### 🔴 F-23. 6.2節が会議ロジ2機能の出力契約を定義していない

**該当**: 共通設計方針書 6.2節「TypeScript での型定義」、14.1節「抽出系と推薦系の違い」、14.2節「機能別の詳細」

**事実**:

- 6.2節が型定義を示しているのは `ic-card.parse-reservation` **だけ**。14.2節は `meeting.parse-candidates`（#979）と `meeting.parse-availability`（#980）に taskId と `SKILL.md` のパスを割り当てているのに、**出力の形はドキュメントのどこにも書かれていない**
- 14.1節は3機能とも「抽出系」で「Structured Output の共通部品」により共通化の度合いが高いとしている。しかし同じ節の「個別設計する部分」に「出力スキーマ（TypeScript 型定義）」が挙がっており、**共通なのは `message` と `sources` の2つだけ**。本体のフィールドは機能ごとに個別設計が要る。つまり2機能分の個別設計が抜けている

**あわせて指摘**: 14.2節の**非AI経路の列が、出力契約の値域を実質的に決めている**。

| 機能 | 14.2節の非AI経路 | 出力契約への制約 |
| --- | --- | --- |
| #979 候補日程設定 | カレンダーで手動選択 | 条件ではなく**具体的な候補日程の列**を返す必要がある |
| #980 参加可否回答 | 各候補に手動で**○×** | 参加可否は**2値**。○/×/△ や時間帯付きにすると手で埋める側と形が揃わない |

9.2節（非AI経路）が「AI が埋めた項目を編集・削除できる」ことを求めているため、**AI の出力は手で埋める形と同じでなければならない**。この含意が6節にも9節にも書かれていない。

**修正案**: 6.2節に2機能の型定義を追加する。検証環境では次の形を採った。

```typescript
// meeting.parse-candidates
interface ParseCandidatesOutput {
  candidates: Array<{
    date: string;       // YYYY-MM-DD
    start_time: string; // HH:mm
    end_time: string;   // HH:mm
  }>;                   // 多くとも10件。読み取れない場合は空配列
  message: string;
  sources: string[];
}

// meeting.parse-availability
interface ParseAvailabilityOutput {
  availability: Array<{
    date: string;       // YYYY-MM-DD
    available: boolean; // ○×の2値
  }>;                   // 多くとも10件。読み取れない場合は空配列
  message: string;
  sources: string[];
}
```

設計上の判断を3つ添える。

1. **所要時間（`duration`）を持たない。** 「3時間」は `end_time - start_time` で導けるため、両方持つと不整合の余地ができる
2. **件数に上限を置く。** 上限が無いとモデルが全営業日を返して画面が壊れるが、スキーマには適合しているので Structured Output の再試行（6.3節）に引っかからない。会議調整で提示する候補は数件であって全営業日ではないので、ドメイン的にも上限が正しい
3. **参加可否を候補IDではなく日付で写すことにした。** リクエスト契約に候補一覧を運ぶ経路を作らないため。判断の詳細は `docs/adr/0003-runtime-input-natural-language-only.md`

**祝日・営業日の判定はモデルに求めない。** 外部知識であり、会議ロジドメインエージェントは Websearch を持たない（F-22）ので裏を取る手段がない。7.1節が会議ロジに Websearch を挙げていないことと整合する。
