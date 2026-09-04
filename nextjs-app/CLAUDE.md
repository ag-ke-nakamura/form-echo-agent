@AGENTS.md

## Project overview

Next.js 16 + pnpm。検証環境のフロントエンド層で、BFF（`hono-app`）経由で Runtime を叩く。
SSG なので BFF の宛先 `NEXT_PUBLIC_API_BASE_URL` はビルド時に埋め込まれる。
`agentcore.json` からは参照されない（デプロイ対象は `agent-app/` だけ）。

画面は1つで、AI 機能ごとのタブを持つ（`app/form-echo-tabs.tsx`）。**タブ1〜3 は縦積み**で、
上から「見出し → AI入力アシスタント（折りたたみ、初期は展開）→ 区切り線『または、手動で入力』
→ 非AI経路のフォーム」の順に並ぶ（#73。設計書 `temp/design/` の共通レイアウト）。
タブ4だけはこの構造を採らない — 自然文入力欄も区切り線も持たない。

- `app/reservation-panel.tsx` — 交通IC予約。スカラーの平坦なマップ
- `app/candidates-panel.tsx` — 会議候補日設定。候補日程の配列。**状態は `useCandidateRows()`
  として切り出してあり、実体は `FormEchoTabs` が持つ**（参加可否タブが同じ候補日程を読むため）
- `app/availability-panel.tsx` — 参加可否回答。候補日程（識別子・日付・開始時刻）を
  受け取って与件として送り、可否は日付ごとに○×だけを持つ。**候補日程ごとの4状態と
  日付でのグループ化は #70**
- `app/recommend-panel.tsx` — 候補日提案（推薦系）。参加可否表は読み取り専用の与件で、
  職員が触るのは「開催する候補日程を1つ選ぶ」ラジオと「別のサンプルに差し替え」だけ
- `app/lib/availability-table.ts` — 参加可否表のモック生成器（#58 のシーム3）
- `app/lib/meeting-info.ts` — 会議情報の表示文字列と、所要時間から終わる時刻を導く関数。
  **値域（参加形式・参加可否・所要時間の選択肢）は `contracts/meeting.ts` にある**
- `app/ai-assistant.tsx` — **抽出系3タブ**が共有する AI入力アシスタント。違うのは `taskId` と
  文言だけ。**`sessionId` と会話ログをタブごとにここで持つ**（タブは別々の会話として進む）。
  候補日提案タブはこれを使わず、`recommend-panel.tsx` が「AI提案」ボタンだけを持つ
- `app/ai-notice.tsx` — 失敗の表示（`role="alert"` `aria-live="assertive"`）。AI入力アシスタントと
  候補日提案タブの両方から引く
- `app/screen-layout.tsx` — タブ見出しと「または、手動で入力」の区切り線
- `app/field-source.tsx` — 「AI 由来か手入力か」の印と、再生成の報告（`ApplyReport`）。
  **タブ間で共有するのはこれだけ**で、フォームの状態モデルはタブごとに分ける
  （汎用のフォーム状態モデルを作らない）

## 複数回やり取り（#38）

追加の指示は同じ `sessionId` で送り直す。**交通ICを除く3タブは画面の状態を `input` として
毎回送り直す**（ADR-0005。Runtime 側の会話履歴はコールドスタートで消えるので、初回だけ送ると
2回目が「与件の無いリクエスト」になる）。何を送るかは taskId ごとに `TaskInputs`（`lib/api.ts`）が
契約の `INPUT_SCHEMAS` から導くので、画面側で書き写さない。交通ICだけは `input={undefined}` を
明示する（送るべき画面状態が無い）。

`input` が運ぶのは画面の**今の**状態だけで、前に何を指示したかは Runtime 側の会話履歴にしか
ない。だから `sessionId` が返ってこない応答は成功にせず `PARSE_FAILED` にする
（そうしないと追加の指示が黙って初回として扱われ、会話が切れたことに気づけない）。

**再生成は AI 由来の値だけを上書きし、手で直した値には触らない。** これで AI バッジが
「再生成で上書きされる範囲」の印としても働く。守る単位はタブごとに違う。

| タブ | 守る単位 | 理由 |
| --- | --- | --- |
| 交通IC | 欄 | 欄が固定なので1対1で対応が付く |
| 会議候補日設定 | 行 | 作り直された列と既にある行を対応付ける手がかりが無い（AI は新しい候補日程を作るので識別子を返さない） |
| 参加可否回答 | 日付 | 手で付けた可否は本人の予定そのもので、自然文からの読み取りより確か |
| 候補日提案 | 開催する候補日程の選択 | AI が埋めるのは順位と理由だけで、職員が触れる欄はこの1つしかない |

触らなかった分は `ApplyReport` に載せて出す。**`message` では代われない** — あれは
モデルが書いた文であって、画面が実際に反映したかどうかは保証しない。抽出系3タブは
会話ログのターンに、候補日提案タブは AI提案バナーの下に添える（`ApplyReportView`）。

**ADR-0006（プレビューを挟んでから反映する）はまだ入っていない**（#65）。4タブとも
応答が来た瞬間にフォームへ書き込む従来の形のままで、#73 が変えたのは器だけ。

`onResult` / `onReset` は `AiAssistant` の中で ref に写して最新のものを呼ぶ。応答を待つ間に
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

## デザイントークン（#73）

設計書に出てくるクラス名がそのままコードに現れるよう、`app/globals.css` の `@theme` に色24個・
タイポグラフィ8個を置いている。**デジタル庁デザインシステム（DADS）の名前を借りているだけで
値は DADS のものではない** — 理由は `globals.css` のコメント。設計書に無いトークンを足さない
（使われないトークンは「設計書にある」の証拠にならない）。

設計書は明るい面だけで書かれているので、`prefers-color-scheme: dark` の反転は持たない。
`dark:` 変種を書くと、トークンで塗った面だけが明るいまま浮く。

アイコンは `lucide-react`（**dependency**。ブラウザへ配られるので devDependency ではない）。

## Commands

- 依存インストール: `pnpm install`
- 開発サーバー: `pnpm run dev`
- ビルド: `pnpm run build`
- Lint: `pnpm run lint`（ESLint。`eslint.config.mjs`）
- Format: `pnpm run format`（チェックのみ: `pnpm run format:check`）
- テスト: `pnpm run test`（vitest。対象は参加可否表のモック生成器だけ）

`typecheck` スクリプトは未定義（`hono-app` とは非対称）。型検証は `pnpm run build` が兼ねている。

**`app/lib` の純関数はテストする。コンポーネントのテストは書かない**（#23 Testing Decisions の
線引きを #67 で言い直したもの）。

線引きは**画面を描かないと確かめられないかどうか**にある。`app/lib` にあるのは、生成ロジック
（`availability-table.ts`）・表示文字列と導出（`meeting-info.ts`）・エラーの案内
（`error-guidance.ts`）で、どれも入力と出力が値で閉じている。JSX の中に埋めたままだと、
区切りを変えても終わる時刻の計算を間違えても、誰かが動かして見ない限り気付かない。
**判断を持つコードが `app/*.tsx` に育ったら、テストを書くのではなく `app/lib` へ出す。**

コンポーネントを書かないのは #23 の方針のまま。出力契約からフォーム状態への写像を素直な代入に
留め、デモは手動で確認する。写像に条件分岐が育った時点で見直す。

vitest は tsconfig の `paths` を見ないので、`@contracts/*` の別名は `vitest.config.mts` にも
書いてある。`next.config.ts` の `turbopack.root` も同じ事情で、**`contracts/` がプロジェクトの
外にある**ためリポジトリルートを root として渡している。型としてしか使わない import
（`import type`）は実行時に消えるので今まで露見しなかったが、`meeting.ts` /
`prompt-requirement.ts` を値として引いた時点でバンドラの解決が要る。この2つを `index.js`
ではなくモジュール直指しで、しかも拡張子なしで引いているのはそのため（`.js` を付けると
バンドラが `.ts` の実体を見つけられない。値として zod を持つモジュールを巻き込まないためでもある）。

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
