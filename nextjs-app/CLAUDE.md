@AGENTS.md

## Project overview

Next.js 16 + pnpm。検証環境のフロントエンド層で、BFF（`hono-app`）経由で Runtime を叩く。
SSG なので BFF の宛先 `NEXT_PUBLIC_API_BASE_URL` はビルド時に埋め込まれる。
`agentcore.json` からは参照されない（デプロイ対象は `agent-app/` だけ）。

画面は1つで、AI 機能ごとのタブを持つ（`app/form-echo-tabs.tsx`）。

- `app/reservation-panel.tsx` — 交通IC予約。スカラーの平坦なマップ
- `app/candidates-panel.tsx` — 会議候補日設定。候補日程の配列。**状態は `useCandidateRows()`
  として切り出してあり、実体は `FormEchoTabs` が持つ**（参加可否タブが同じ候補日程を読むため）
- `app/availability-panel.tsx` — 参加可否回答。候補日程の日付を受け取り、○×だけを持つ
- `app/ai-chat-panel.tsx` — 全タブ共通の AI チャット欄。違うのは `taskId` と文言だけ。
  **`sessionId` と会話ログをタブごとにここで持つ**（タブは別々の会話として進む）
- `app/field-source.tsx` — 「AI 由来か手入力か」の印と、再生成の報告（`ApplyReport`）。
  **タブ間で共有するのはこれだけ**で、フォームの状態モデルはタブごとに分ける
  （汎用のフォーム状態モデルを作らない）

## 複数回やり取り（#38）

追加の指示は同じ `sessionId` で送り直す。**リクエストに載るのは `{taskId, prompt, sessionId}`
だけで、画面が持っているフォームの状態は運ばない**（ADR-003）。前の指示の内容は Runtime 側の
会話履歴にしかないので、`sessionId` が返ってこない応答は成功にせず `PARSE_FAILED` にする
（そうしないと追加の指示が黙って初回として扱われ、会話が切れたことに気づけない）。

**再生成は AI 由来の値だけを上書きし、手で直した値には触らない。** これで AI バッジが
「再生成で上書きされる範囲」の印としても働く。守る単位はタブごとに違う。

| タブ | 守る単位 | 理由 |
| --- | --- | --- |
| 交通IC | 欄 | 欄が固定なので1対1で対応が付く |
| 会議候補日設定 | 行 | 作り直された列と既にある行を対応付ける手がかりが無い（行の識別子は画面だけのもので出力契約に乗らない） |
| 参加可否回答 | 日付 | 手で付けた可否は本人の予定そのもので、自然文からの読み取りより確か |

触らなかった分は `ApplyReport` に載せて会話ログに出す。**`message` では代われない** —
あれはモデルが書いた文であって、画面が実際に反映したかどうかは保証しない。

`onResult` / `onReset` は `AiChatPanel` の中で ref に写して最新のものを呼ぶ。応答を待つ間に
職員がフォームを触ると、実行中のクロージャが掴んでいる古い関数が編集前の状態を見て上書きの
可否を決めてしまい、待っている間の手入力を踏み潰す。

同じ理由で送信ごとに連番（`submitSerial`）を振り、応答が返る前に「最初からやり直す」が
押されたらその結果を捨てる。飛んでいるリクエストは止まらないので、捨てないと空にしたはずの
フォームが数秒後に埋まる。

既知の穴: 「消す」で空にした AI 由来の欄は次の再生成で埋め直される（空欄は初期状態と
区別が付かない）。分けるには `FieldSource` に3つ目の状態が必要で、3タブすべての印の意味が
変わるため第1段では踏み込まない。

出力契約は tsconfig の `paths` で `@contracts/*` として引く（emit しないので `rootDir` の
制約を受けない）。詳細はリポジトリルートの `CLAUDE.md` と `docs/adr/0002-contracts-as-plain-ts.md`。

## Commands

- 依存インストール: `pnpm install`
- 開発サーバー: `pnpm run dev`
- ビルド: `pnpm run build`
- Lint: `pnpm run lint`（ESLint。`eslint.config.mjs`）
- Format: `pnpm run format`（チェックのみ: `pnpm run format:check`）

`typecheck` スクリプトは未定義（`hono-app` とは非対称）。型検証は `pnpm run build` が兼ねている。

テストは未設定。**フロントエンドの自動テストは意図的に持たない**（#23 Testing Decisions）。
出力契約からフォーム状態への写像を素直な代入に留め、デモは手動で確認する方針のため。
写像に条件分岐が育った時点で見直す。

### lint と format で別ツールを使っている理由

- **lint = ESLint**: `eslint-config-next` の core-web-vitals 系ルール（`no-img-element`,
  `no-html-link-for-pages` 等）に biome の等価物が無いため、biome に置き換えると検査を失う。
- **format = Biome**: `eslint-config-next` は整形を行わない。他プロジェクト（`app/FormEchoAgent`,
  `hono-app`）と揃えて biome を使う。
- `biome.json` の `linter.enabled` は **false**。有効にすると biome と ESLint が同じコードを
  別基準で lint して衝突する。この理由から `format:check` も他プロジェクトの `biome check .`
  ではなく `biome format .`（lint を含まない）にしている。
- `biome.json` の `css.parser.tailwindDirectives` は **true** が必須。無いと Tailwind v4 の
  `@theme` / `@custom-variant` を biome の CSS パーサーが解釈できず `app/globals.css` で落ちる。
- `biome.json` は JSON with comments を受け付けない（コメントを書くと設定全体が無視され既定値に
  フォールバックする）。設定意図はこのファイルに書くこと。

## 言語方針

本プロジェクト（FormEcho 全体）は**日本語を基本言語**として運用します。詳細は `../CLAUDE.md` の「言語方針」セクションを参照してください。

簡潔に：
- **Git コミット・コードコメント・ドキュメント**: すべて日本語
- **スキルのフォーマット**: 各スキルに従いながら、記述は日本語
- **AGENTS.md は手編集不可**: `next dev` が自動生成するため
