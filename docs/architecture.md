# アーキテクチャ構成図

この検証環境の構成を図にしたもの。正典はコードと ADR であり、この文書はそれを俯瞰するための地図。

## 1. 全体構成

3プロジェクトはそれぞれ入出力契約（Zod v4 スキーマ）を自己完結で持ち（ADR-0011）、HTTP で直列につながる。

```mermaid
graph LR
    subgraph browser["ブラウザ"]
        UI["nextjs-app<br/>SSG フロントエンド :3000<br/>[[app/lib/contracts/]]"]
    end

    subgraph bff_box["BFF"]
        BFF["hono-app<br/>Hono :8787<br/>[[src/schemas/]]"]
    end

    subgraph runtime_box["AgentCore Runtime"]
        RT["agent-app/app/FormEchoAgent<br/>Strands Agent :8080<br/>[[contracts/]]"]
    end

    subgraph aws["AWS"]
        BR["Bedrock<br/>jp.anthropic.claude-*"]
    end

    UI -->|"POST /api/ai/tasks<br/>{taskId, prompt, sessionId, input}"| BFF
    BFF -->|"POST /invocations<br/>+ X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"| RT
    RT -->|"Converse (stream: false)"| BR
```

宛先はすべて環境変数で切り替わる。

| 変数 | 置き場所 | 意味 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | nextjs-app | BFF の URL（SSG なのでビルド時に埋め込まれる） |
| `FORMECHO_RUNTIME_URL` | hono-app | Runtime の URL |
| `FORMECHO_RUNTIME_CLIENT` | hono-app | `local` / `deployed` / `fake` |
| `FORMECHO_RUNTIME_ARN` | hono-app | デプロイ済み Runtime の ARN（`deployed` のときだけ要る） |
| `FORMECHO_MODEL` | agent-app | `sonnet` / `haiku` / `fake` |

## 2. リクエスト1回の流れ

各層が何を判断するか。**判断は各プロジェクト内の契約側の関数に置き、同じ判断をプロジェクト内の2箇所に書かない**（ADR-0011）。

```mermaid
sequenceDiagram
    actor Staff as 職員
    participant UI as nextjs-app
    participant BFF as hono-app
    participant H as handler
    participant IT as invokeTask
    participant AG as ドメインエージェント
    participant BR as Bedrock

    Staff->>UI: 自然文を入力（AI入力アシスタント）
    UI->>BFF: POST /api/ai/tasks

    Note over BFF: authenticate（現状は素通し）<br/>isTaskId で許可リスト照合<br/>checkTaskInput（契約の表）<br/>sanitizePrompt（10,000字上限）<br/>sessionId の発行 / UUID 検証

    BFF->>H: POST /invocations
    Note over H: aiTaskRequestSchema で再検査

    H->>IT: {taskId, prompt, input, sessionId}
    Note over IT: getOrCreateDomainAgent<br/>（sessionId::taskId で LRU 128）<br/>buildSystemPrompt → SKILL.md 注入<br/>buildUserMessage

    loop 最大2回（invokeWithSchemaRetry）
        IT->>AG: invoke(structuredOutputSchema)
        AG->>BR: Converse
        BR-->>AG: Structured Output
        AG-->>IT: 結果
        Note over IT: outputSchemaFor(taskId, input) で検査<br/>落ちたら履歴を巻き戻して作り直し
    end

    IT-->>H: {result, usage}
    H-->>BFF: {sessionId, result, usage}
    Note over BFF: 出力契約でもう一度検査<br/>（BFF は自分の複製したスキーマで独立に見る）
    BFF-->>UI: 200 / エラーコード
    Note over UI: プレビュー表示（ADR-0006）
    Staff->>UI: 「反映」でフォームへ書き込む
```

## 3. taskId とドメインエージェント

`taskId` が唯一のルーティングキー。ドット前がドメイン、ドット後が Skill を一意に決める。

```mermaid
graph TD
    T1["ic-card.parse-reservation"] --> D1
    T2["meeting.parse-candidates"] --> D2
    T3["meeting.parse-availability"] --> D2
    T4["meeting.recommend-schedule"] --> D2

    D1["交通ICドメインエージェント<br/>tools: []"]
    D2["会議ロジドメインエージェント<br/>tools: []"]

    T1 -.-> S1["skills/ic-card/parse-reservation.ts"]
    T2 -.-> S2["skills/meeting/parse-candidates.ts"]
    T3 -.-> S3["skills/meeting/parse-availability.ts"]
    T4 -.-> S4["skills/meeting/recommend-schedule.ts"]

    S1 & S2 & S3 & S4 --> SP["buildSystemPrompt<br/>（基準時刻を付けて注入）"]
```

ドメイン間で協調しないので、Strands の Graph / Swarm / agent-as-tool は使わない。会議ロジは Websearch を持たない（F-22）。

## 4. 各プロジェクトの契約定義

共有ディレクトリは無く、3プロジェクトがそれぞれ自分のパッケージ内に複製を持つ（ADR-0011）。
複製元は同じなので現状は内容が一致しているが、3者間のドリフトを検知する自動テストは無い
（意図的。実運用で BFF の `PARSE_FAILED` 等として顕在化する）。

```mermaid
graph TD
    A["Runtime<br/>agent-app/app/FormEchoAgent/contracts/"] --> AU["Zod で検査する<br/>（リクエスト・Structured Output）"]
    B["BFF<br/>hono-app/src/schemas/"] --> BU["Zod で検査する<br/>（門・応答の再検査）"]
    N["フロントエンド<br/>nextjs-app/app/lib/contracts/"] --> NU["ほぼ import type。値で引くのは<br/>zod を持たない meeting.ts /<br/>prompt-requirement.ts だけ<br/>（SSG のバンドルに zod を乗せない）"]
```

3プロジェクトとも自分自身の `node_modules` から `zod` を通常どおり解決する（symlink も
tsconfig の `paths` エイリアスも不要）。`recommendation.ts`（候補日提案の導出・集計）は
nextjs-app だけが持つ — 他プロジェクトは使っていないため複製していない。

契約が持つ「表」（各プロジェクトの複製に共通する内容）。

| 表 | 決めること |
| --- | --- |
| `ALLOWED_TASK_IDS` | 受け付ける taskId |
| `checkTaskInput` | taskId ごとに自然文・構造化入力のどちらが要るか（ADR-0004） |
| `INPUT_SCHEMAS` | 構造化入力の形（ADR-0005：画面の状態を Runtime へ渡す） |
| `OUTPUT_SCHEMAS` / `outputSchemaFor` | 出力契約。入力を見ないと言えない不変条件も載る |
| `AiErrorCode` | エラーコードの語彙 |

`input`（構造化入力）が taskId ごとに運ぶもの。**サニタイズも Guardrail チェックも通さないので自由文字列を置かない** — 識別子は正規表現で縛り、参加者の実名はブラウザから出さない（ADR-0008）。

| taskId | `input` |
| --- | --- |
| `ic-card.parse-reservation` | `null`（送るべき画面状態が無い） |
| `meeting.parse-candidates` | 所要時間のみ |
| `meeting.parse-availability` | 参加形式・所要時間・候補日程の一覧 |
| `meeting.recommend-schedule` | 参加形式・所要時間・参加者の名簿・参加可否表 |

識別子はフロントエンドが発番し、AI は自分では作らない。**追加の指示のときも `input` を毎回そのまま送り直す** — Runtime 側の会話履歴はコールドスタートで消えるため、初回だけ送ると2回目が与件の無いリクエストになる（ADR-0004）。

## 5. 差し替え口（テストの決定性）

テストと実測は同じ境界を通り、違うのは設定だけにする（#40 / #41）。

```mermaid
graph LR
    BFFC["invokeRuntime<br/>（応答の解釈）"] --> TR{"loadRuntimeTransport<br/>FORMECHO_RUNTIME_CLIENT"}
    TR -->|local| L["localTransport → HTTP"]
    TR -->|deployed| D["deployedTransport<br/>SigV4 InvokeAgentRuntime"]
    TR -->|fake| F["fakeRuntimeTransport"]

    AGN["ドメインエージェント"] --> ML{"loadModel<br/>FORMECHO_MODEL"}
    ML -->|sonnet / haiku| BM["BedrockModel"]
    ML -->|fake| FM["FakeModel"]
```

差し替わるのは「Runtime が何を返したか」であって「それをどう扱うか」ではない。エラーコードへの写像と出力契約の再検査は `invokeRuntime` の1箇所を必ず通る。

## 6. エラーの写像

```mermaid
graph LR
    subgraph rt["Runtime"]
        E1["リクエストが契約に不適合"] --> C1["INVALID_INPUT"]
        E2["StructuredOutputError<br/>（2回とも契約に届かず）"] --> C2["PARSE_FAILED"]
        E3["想定外の失敗"] --> C3["throw → 500"]
    end

    subgraph bff["BFF"]
        C1 --> B1["400"]
        C2 --> B2["502"]
        C3 --> B3["RUNTIME_UNAVAILABLE / 503"]
        T["TimeoutError（60s）"] --> B4["TIMEOUT / 504"]
        X["接続不能"] --> B3
        Y["Runtime が 4xx"] --> B5["INTERNAL_ERROR / 500"]
    end

    B1 & B2 & B3 & B4 & B5 --> UI["画面の案内<br/>（再入力を促す / 非AI経路へ移す）"]
```

すべての AI 機能に**非AI経路**が確保されているので、どのエラーでも職員はフォームを埋めきれる。

## 7. 本番想定（参照アーキテクチャ・未実装）

以下は `temp/00-arch-design.md` が定める到達点であって、このリポジトリの現状ではない。実際に AWS 上で動いているものは §8。

```mermaid
graph LR
    U["職員のブラウザ"] --> CF["CloudFront + S3<br/>（SSG 静的ファイル）"]
    U --> ALB["ALB"]
    ALB --> ECS["ECS Fargate<br/>BFF（JWT 検証 / 認可 / 監査ログ）"]
    ECS -->|"VPC Endpoint + SigV4<br/>InvokeAgentRuntime"| RT["AgentCore Runtime<br/>microVM"]
    RT --> BR["Bedrock Claude<br/>ap-northeast-1（jp. 推論プロファイル）"]
    RT -->|"第3段・交通ICのみ"| GW["AgentCore Gateway → Websearch"]
    ECS --> CW["CloudWatch Logs"]
    RT --> CW
```

現状との差分。

- **front door** — ALB + ECS Fargate は据え置きの到達点で、デプロイ済み検証環境は CloudFront + Lambda Function URL を選んだ（ADR-0014。決め手は API Gateway の29秒ではなく時間予算そのもの）。本番へ持っていけるのは `hono-app` の中身と入出力契約であって CDK スタックではない
- **認証** — `middleware/auth.ts` は素通し。本番は GSS / Entra の JWT 検証とテナント識別が入る。検証環境はその代わりに front door の手前で Basic 認証を掛ける（#138）
- **Memory** — 会話履歴はプロセス内の LRU（128セッション）で、コールドスタートで消えるベストエフォート。永続化するなら AgentCore Memory を付ける

## 8. デプロイ済み検証環境（実装）

ブラウザから URL を開いて触れる状態。front door はルートの `infra/`（ADR-0014）、Runtime と Gateway は `agentcore deploy`、Guardrail は `agent-app/infra`（ADR-0010）が作る。

```mermaid
graph LR
    U["職員のブラウザ"] -->|"Basic 認証<br/>CloudFront Function（viewer request）"| CF["CloudFront<br/>（単一オリジン）"]
    CF -->|"default behavior<br/>OAC + SigV4"| S3["S3（非公開）<br/>SSG 静的ファイル"]
    CF -->|"/api/*<br/>OAC + SigV4"| FU["Lambda Function URL<br/>authType: AWS_IAM"]
    FU --> BFF["BFF（Node 22）<br/>hono-app/src/lambda.ts"]
    BFF -->|"SigV4<br/>InvokeAgentRuntime"| RT["AgentCore Runtime<br/>microVM"]
    RT --> BR["Bedrock Claude<br/>ap-northeast-1（jp. 推論プロファイル）"]
    RT --> GR["Bedrock Guardrail"]
    RT -->|"第3段・交通ICのみ"| GW["AgentCore Gateway → Websearch"]
    BFF --> CW["CloudWatch Logs"]
    RT --> CW
```

本番想定（§7）と違うところ。

- **オリジンは CloudFront 1つ。** `/api/*` がパス透過で BFF に届くので CORS が発生せず、`NEXT_PUBLIC_API_BASE_URL` は空文字（相対パス）でよい。**BFF の `cors`（`FORMECHO_ALLOWED_ORIGINS`）はここでは実質効かない**が、ローカルは :3000 → :8787 の2オリジンのままなので残してある
- **コード改修0行では済まなかった。** ADR-0014 は「フロントのコード改修は0行」で採ったが、OAC 越しの POST は本文の SHA256 を呼び出し側が `x-amz-content-sha256` に載せる必要があり、`nextjs-app/app/lib/api.ts` が `hc` に渡す `fetch` を包んでいる。BFF 側も Lambda のエントリ `hono-app/src/lambda.ts` が増えた（ルーティングと判断は `src/index.ts` に残る）
- **Function URL は公開 DNS 名だが公開エンドポイントではない。** `authType` は `AWS_IAM` で、resource policy が principal と `AWS:SourceArn` の両方でこの CloudFront に絞る。**OAC は `Authorization` を自分の署名に差し替えるので、`/api/*` の origin request policy はビューアの `Authorization` を転送しない**（Basic 認証が読むのと同じヘッダ）
- **BFF は VPC の外にいる。** Runtime を叩くのは VPC Endpoint ではなく Lambda の実行ロール（`bedrock-agentcore:InvokeAgentRuntime` を Runtime の ARN に限定）
- **時間予算は本番想定と同じ。** Runtime の自己打ち切り55秒（#125）→ BFF 60秒 → 画面60秒。CloudFront の origin response timeout 60秒はこの外側

## 9. ローカルの3プロセス

```mermaid
graph LR
    M["mise run dev"] --> P1["agent-app/<br/>agentcore dev --logs --skip-deploy<br/>:8080"]
    M --> P2["hono-app/<br/>pnpm run dev（Bun）<br/>:8787"]
    M --> P3["nextjs-app/<br/>pnpm run dev<br/>:3000"]
```

ルートの `package.json` は pnpm workspace の宣言専用でスクリプトを持たない（ADR-0015）ため、この定義は `mise.toml` の `[tasks.*]` に置く。
