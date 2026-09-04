# アーキテクチャ構成図

この検証環境の構成を図にしたもの。正典はコードと ADR であり、この文書はそれを俯瞰するための地図。

## 1. 全体構成

3プロジェクトが `contracts/`（入出力契約）だけを共有し、HTTP で直列につながる。

```mermaid
graph LR
    subgraph browser["ブラウザ"]
        UI["nextjs-app<br/>SSG フロントエンド :3000"]
    end

    subgraph bff_box["BFF"]
        BFF["hono-app<br/>Hono :8787"]
    end

    subgraph runtime_box["AgentCore Runtime"]
        RT["agent-app/app/FormEchoAgent<br/>Strands Agent :8080"]
    end

    subgraph aws["AWS"]
        BR["Bedrock<br/>jp.anthropic.claude-*"]
    end

    CT[["contracts/<br/>Zod v4 スキーマ"]]

    UI -->|"POST /api/ai/tasks<br/>{taskId, prompt, sessionId, input}"| BFF
    BFF -->|"POST /invocations<br/>+ X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"| RT
    RT -->|"Converse (stream: false)"| BR

    CT -.->|型のみ| UI
    CT -.->|検査| BFF
    CT -.->|検査| RT

    classDef contract fill:#fff4e6,stroke:#d9822b,stroke-width:2px
    class CT contract
```

宛先はすべて環境変数で切り替わる。

| 変数 | 置き場所 | 意味 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | nextjs-app | BFF の URL（SSG なのでビルド時に埋め込まれる） |
| `FORMECHO_RUNTIME_URL` | hono-app | Runtime の URL |
| `FORMECHO_RUNTIME_CLIENT` | hono-app | `local` / `fake` |
| `FORMECHO_MODEL` | agent-app | `sonnet` / `haiku` / `fake` |

## 2. リクエスト1回の流れ

各層が何を判断するか。**判断は契約側の関数に置き、同じ判断を2箇所に書かない**（ADR-0002）。

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
    Note over BFF: 出力契約でもう一度検査<br/>（3者が同じ契約を見ることを実際に効かせる）
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

    T1 -.-> S1["skills/ic-card/parse-reservation/SKILL.md"]
    T2 -.-> S2["skills/meeting/parse-candidates/SKILL.md"]
    T3 -.-> S3["skills/meeting/parse-availability/SKILL.md"]
    T4 -.-> S4["skills/meeting/recommend-schedule/SKILL.md"]

    S1 & S2 & S3 & S4 --> SP["buildSystemPrompt<br/>（基準時刻を付けて注入）"]
```

ドメイン間で協調しないので、Strands の Graph / Swarm / agent-as-tool は使わない。会議ロジは Websearch を持たない（F-22）。

## 4. contracts の解決経路

パッケージ化せず素の `.ts` で置き、各プロジェクトが自前の経路で参照する（ADR-0002）。

```mermaid
graph TD
    C["contracts/<br/>task-ids.ts / api.ts / inputs.ts /<br/>outputs.ts / output-schema.ts /<br/>task-input.ts / errors.ts ほか"]

    C -->|"symlink<br/>app/FormEchoAgent/contracts/"| A["Runtime"]
    C -->|"tsconfig paths @contracts/*"| B["BFF"]
    C -->|"tsconfig paths @contracts/*"| N["フロントエンド"]

    A --> AU["Zod で検査する<br/>（リクエスト・Structured Output）"]
    B --> BU["Zod で検査する<br/>（門・応答の再検査）"]
    N --> NU["ほぼ import type。値で引くのは<br/>zod を持たない meeting.ts /<br/>prompt-requirement.ts だけ<br/>（SSG のバンドルに zod を乗せない）"]
```

契約が持つ「表」。

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

`agent-app/agentcore/aws-targets.json` が空のため **`agentcore deploy` と `cdk synth` は実行できない**。以下は `temp/00-arch-design.md` が定める到達点であって、このリポジトリの現状ではない。

```mermaid
graph LR
    U["職員のブラウザ"] --> CF["CloudFront + S3<br/>（SSG 静的ファイル）"]
    U --> ALB["ALB"]
    ALB --> ECS["ECS Fargate<br/>BFF（JWT 検証 / 認可 / 監査ログ）"]
    ECS -->|"VPC Endpoint + SigV4<br/>InvokeAgentRuntime"| RT["AgentCore Runtime<br/>microVM"]
    RT --> BR["Bedrock Claude<br/>ap-northeast-1（jp. 推論プロファイル）"]
    RT -.->|"第3段・交通ICのみ"| GW["AgentCore Gateway → Websearch"]
    ECS --> CW["CloudWatch Logs"]
    RT --> CW

    classDef todo stroke-dasharray: 5 5
    class GW todo
```

現状との差分。

- **認証** — `middleware/auth.ts` は素通し。本番は GSS / Entra の JWT 検証とテナント識別が入る
- **Runtime クライアント** — `local`（HTTP）のみ。デプロイ済み Runtime を SigV4 で叩く `deployed` を `runtime-transport.ts` に足す
- **Guardrail チェック** — 未実装。BFF ではなく Runtime のモデル呼び出し前後に置くと決めてある（ADR-0001）
- **Memory** — 会話履歴はプロセス内の LRU（128セッション）で、コールドスタートで消えるベストエフォート。永続化するなら AgentCore Memory を付ける

## 8. ローカルの3プロセス

```mermaid
graph LR
    M["mise run dev"] --> P1["agent-app/<br/>agentcore dev --logs --skip-deploy<br/>:8080"]
    M --> P2["hono-app/<br/>pnpm run dev（Bun）<br/>:8787"]
    M --> P3["nextjs-app/<br/>pnpm run dev<br/>:3000"]
```

ルートに `package.json` を置かない方針のため、この定義は `mise.toml` の `[tasks.*]` にしか置けない。
