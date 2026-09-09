@AGENTS.md

## Project overview

Next.js 16 + pnpm。検証環境のフロントエンド層で、BFF（`hono-app`）経由で Runtime を叩く。
SSG なので BFF の宛先 `NEXT_PUBLIC_API_BASE_URL` はビルド時に埋め込まれる。
`agentcore.json` からは参照されない（デプロイ対象は `agent-app/` だけ）。

## ディレクトリ（ADR-0016）

`src/` を feature で切る。`src/app/` はルートと組み立てだけを持ち、機能は**交通IC と会議ロジの
2 feature**。会議の内側は画面ごとに割る。

```
src/
  app/                    layout / page / globals.css と form-echo-tabs.tsx（組み立て）
  features/ic-card/       交通IC予約
  features/meeting/
    candidates/           会議候補日設定
    availability/         参加可否回答
    recommend/            候補日提案
    shared/               3画面が読む会議情報・2画面が読む件数の上限
  components/ai-assistant/ 抽出系3タブが共有する AI入力アシスタント一式
  components/             タブ見出し・区切り線・フォームの枠
  lib/                    BFF クライアント・プレビューの語彙・エラーの案内・出典
  lib/contracts/          入出力契約の複製（ADR-0011）
```

**4タブだが feature は2つ。** タブ2〜4（会議ロジ）は会議情報・候補日程・件数の上限を共有して
いるので、4 feature に割るとそれらが全部 feature 跨ぎになり、共有先が top-level しか無くなる
（会議ドメイン固有のものが「共有」に溜まって元のフラット構成が名前を変えて復活する）。

**feature の境界を跨ぐ import は `@/` 始まり、feature 内は相対。** `@/*` は `tsconfig.json` と
`vitest.config.mts` の**両方**が `src` を指す — 片方だけ直すと tsc は解決するのに vitest が
「Cannot find module」で落ちる。この線を `no-restricted-imports` で機械的に止めるのは別チケット
（#158）で、いまは規約だけである。

### ルート（`src/app/`）

画面は1つで、AI 機能ごとのタブを持つ（`form-echo-tabs.tsx`）。**タブ1〜3 は縦積み**で、
上から「見出し → AI入力アシスタント（折りたたみ、初期は展開）→ 区切り線 → 非AI経路のフォーム」の
順に並ぶ（#73。設計書 `temp/design/` の共通レイアウト）。
タブ4だけはこの構造を採らない — 自然文入力欄も区切り線も持たない。
`form-echo-tabs.tsx` は会議情報（`useMeetingInfo`）と候補日程（`useCandidateCalendar`）の
**置き場所**でもある（タブ2〜4 が同じものを読むため。状態モデルの定義は feature 側に残る）。

### 交通IC（`src/features/ic-card/`）

- `reservation-panel.tsx` — 交通IC予約。スカラーの平坦なマップ（状態モデルと写す
  規則は `reservation-form.ts`）。**同行者とICカード利用枚数だけは `FormState` の
  外**にタブが持つ — 出力契約に載せず AI にも埋めさせない欄なので（#68）、中に入れると
  `applyToForm` の写す規則が掛かる欄に見える。同行者は行として足し引きする
- `reservation-form.ts` — 交通ICタブの組み立て（#38・#65）。欄の表示名・状態モデル・
  **AI の結果をフォームへ写す `applyToForm`** とプレビューの一覧

### 会議ロジ（`src/features/meeting/`）

`candidates/` — 会議候補日設定。

- `candidates-panel.tsx` — 非AI経路は**2週間 × 9:00–18:00 の30分カレンダー**（#69）
- `use-candidate-calendar.ts` — カレンダーの状態そのもの。**`useCandidateCalendar(所要時間)`
  として切り出してあり、実体は `FormEchoTabs` が持つ**（参加可否タブが同じ候補日程を読むため）。
  所要時間を要るのは、クリックの受け付けが所要時間抜きには決まらないから。カレンダーの起点
  （今日）は `useSyncExternalStore` を使いブラウザ側だけで決める — SSG なのでビルド機の
  「今日」で描けない（決まるまで `days` は `null`。その間は升目を描かず、AI へも送らせない）。
  **表示範囲は AI への与件に載る**（`calendar_start` / `calendar_end`。ADR-0005 の表）。
  **コンポーネントファイルには置かない** — 状態の持ち主はタブ層で、パネルは描くだけである
- `candidate-calendar.ts` — カレンダーのスロット⇔候補日程の変換（#69）。
  **状態モデル（`CalendarCandidate`）もここ**（純関数がすべてこの形を受けて返す）。
  日付列（`calendarDays`）・升目の時刻（`SLOT_START_TIMES`）・被覆（`candidateSlots`。
  所要時間から導くので集合として抱えない）・**受け付けの梯子（`slotRejection`。件数の上限 →
  表示範囲 → 升目に載るか → 業務時間 → 重なり。塞いでいる候補日程を名指しする）**・
  所要時間を伸ばした後の不整合（`candidateConflicts`。組で返すので理由を捏造しない）・
  グリッドに描けない候補日程（`offGridCandidates`。梯子が断るので通常は空で、最後の網）。
  **クリック（`addCandidateAt`）と AI の反映は同じ梯子を引く** — 別に書くと、クリックでは
  作れない状態が AI 経由で入る。他タブへ渡す形（`SelectedCandidate` / `selectedCandidates`。
  **印（`source`）を落とす**）もここ
- `candidates-form.ts` — AI の結果をカレンダーへ写す組み立て。
  **反映は加算**（`applyAiCandidates`）で、カレンダーに置けない分（重なり・表示範囲の外・
  升目に載らない時刻・上限超え）を見送って `ApplyReport.skipped` で言う。プレビューの一覧は
  同じ判断（`planMerge` → `slotRejection`）を引くので、押したら入るものと入らないものが
  一致する。採番は反映した分だけ進む（`nextSequence`）

`availability/` — 参加可否回答。

- `availability-panel.tsx` — 候補日程（識別子・日付・開始時刻）を
  受け取って与件として送り、**候補日程ごとに4状態の参加可否と備考**を持つ（#70）。
  候補日程は日付で束ねて並べる
- `availability-form.ts` — 参加可否回答フォームの組み立て（#70）。参加形式ごとの
  選択肢と AI 出力の寄せ、日付でのグループ化、**AI の結果を回答へ写す
  `applyAvailabilityResult`**、プレビューの一覧、聞き返しの対象の引き算。参加可否タブの
  状態モデル（`AvailabilityAnswer`）もここにある — 写す規則が3つ重なっており、JSX の中では
  往復を繰り返さない限り確かめられない

`recommend/` — 候補日提案（推薦系。見出しは設計書の画面名「日程確定」）。

- `recommend-panel.tsx` — 参加可否表は読み取り専用の与件で、
  職員が触るのは**開催日のラジオ（ちょうど1つ）と予備日のチェックボックス（0個以上）**、
  根拠のアコーディオン、参加可否表サンプルの切り替え、確定だけ（#72）。
  **AI が返すのは候補日程ごとの評点と根拠**で、AI評価ラベル・集計値・初期選択は
  `@/lib/contracts/recommendation.ts` が導く（#71 / ADR-0007 / #109）。
  **推論はタブが開かれた時に1回だけ走り、選択を変えても再推論しない**（設計書 10.1節）。
  合図は `active` prop — タブは全部描かれたまま `hidden` で隠れているので、マウントを
  合図にするとページを読み込んだだけで Runtime を叩く
- `recommend-form.ts` — 候補日提案タブの組み立て（#71・#72）。状態モデル
  （`ScheduleChoice`）と**AI の提案を職員の選択へ写す `applyRecommendation`**、開催日と
  予備日の遷移（`chooseHost` / `toggleBackup`）、遅れて届いた応答を捨てる
  `ForTable` / `currentValue`、表示文字列（候補日程・参加可能人数・欠席者）、
  折りたたみと初期展開の切り分け、確認ダイアログと完了メッセージの中身
- `availability-table.ts` — 参加可否表のモック生成器（#58 のシーム3）。
  「回答が揃った表 / 回答が途中の表」の2モードを持ち、**名簿は実名と識別子の両方**を
  持つ（Runtime へ送るのは識別子だけ。ADR-0008。落とすのは `tableInput`）。
  **参加可否タブではなくこちらに置く** — 名前に反して実体はタブ4のモックである

`shared/` — 会議ロジの3画面が跨いで読むもの。

- `meeting-info.ts` — 会議情報と参加可否の表示名、所要時間から終わる時刻を導く関数、
  **候補日程と日付の表示文字列**（`weekdayOf` / `dateHeadingText` / `candidateLabel`。#69 で
  タブ3のモジュールからここへ移した — 3画面が引くので、タブ3の中に置くと
  他タブが掘りに行くことになる）。
  **値域（参加形式・参加可否・所要時間の選択肢・候補日程の識別子）は
  `@/lib/contracts/meeting.ts`**（#109）
- `meeting-info-fields.tsx` — 会議情報の入力欄（タブ2）とヘッダー（タブ3）、状態を持つ
  `useMeetingInfo`。表示文字列そのものは `meeting-info.ts` が決める
- `candidate-limit.ts` — 候補日程の件数が入力契約の上限に収まるか。足す側（タブ2）と
  送る側（タブ3）の両方が引く

### 共有コンポーネント（`src/components/`）

- `ai-assistant/ai-assistant.tsx` — **抽出系3タブ**が共有する AI入力アシスタント。違うのは
  `taskId` と文言だけ。責務は「送る・**プレビューを持つ**・反映を親に伝える」（ADR-0006）。
  **`sessionId` をタブごとにここで持つ**（タブは別々の会話として進む）。
  候補日提案タブはこれを使わず、`recommend-panel.tsx` がタブを開いた時に1回だけ推論する
- `ai-assistant/ai-notice.tsx` — 生成中の表示・失敗の表示（`role="alert"`
  `aria-live="assertive"`）・**プレビュー（`AiPreview`）**・反映の報告。失敗の表示は
  AI入力アシスタントと候補日提案タブの両方から引く
- `ai-assistant/field-source.tsx` — 「AI 由来か手入力か」の印と、再生成の報告（`ApplyReport`）。
  **タブ間で共有するのはこれだけ**で、フォームの状態モデルはタブごとに分ける
  （汎用のフォーム状態モデルを作らない）
- `screen-layout.tsx` — タブ見出しと非AI経路の区切り線。文言はタブごとに渡せる
  （設計書の文言を名乗るのは、その非AI経路が設計書の形になったタブだけ）
- `form-section.tsx` — フォームの枠と、`taskId` から引く節の id（アシスタントが縮むときの
  フォーカスの行き先）

**AI入力アシスタントを第3の feature にしない。** これは抽出系3タブが共有するので
feature を跨ぐ。feature にすると境界の禁止線に例外が要り、次の「共有したい」でも例外が
足されて線が意味を失う（ADR-0016）。

### 共有ロジック（`src/lib/`）

- `api.ts` — BFF クライアント（`hc`）。応答封筒と `AiErrorCode` は `hono-app` の `AppType` から
  導出する（ADR-0015。複製を持たない）
- `ai-preview.ts` — プレビューの語彙（ADR-0006）。1行の形（`PreviewItem`。
  埋まった／埋まらなかった／反映しても変わらないの3通り。変わらない理由は
  `preservedReason` で差し替えられる — 加算のタブでは「手入力のため」ではなく
  「既に選んだ候補日程と重なる」）と、**一覧を見て聞き返しかどうかを決める `previewTone`**、
  押す意味があるかの `hasApplicableItems`、連続失敗の上限。
  3タブが共有するのは「結果の見せ方」だけで、フォームの状態モデルは分けたまま
- `error-guidance.ts` — `AiErrorCode` から職員向けの案内へ。BFF の `message` は開発者向け
- `sources.ts` — Web 検索の出典の絞り込み（表示の正典は `citations`。`.claude/rules/contracts.md`）
- `contracts/` — 入出力契約の複製（ADR-0011）。制約は下の「Commands」の後に書いてある

## 複数回やり取り（#38）

追加の指示は同じ `sessionId` で送り直す。**交通ICを除く3タブは画面の状態を `input` として
毎回送り直す**（ADR-0005。Runtime 側の会話履歴はコールドスタートで消えるので、初回だけ送ると
2回目が「与件の無いリクエスト」になる）。何を送るかは taskId ごとに `TaskInputs`（`@/lib/api.ts`）が
契約の `INPUT_SCHEMAS` から導くので、画面側で書き写さない。交通ICだけは `input={undefined}` を
明示する（送るべき画面状態が無い）。

`input` が運ぶのは画面の**今の**状態だけで、前に何を指示したかは Runtime 側の会話履歴にしか
ない。だから `sessionId` が返ってこない応答は成功にせず `PARSE_FAILED` にする
（そうしないと追加の指示が黙って初回として扱われ、会話が切れたことに気づけない）。

**反映は AI 由来の値だけを上書きし、手で直した値には触らない。** これで AI バッジが
「反映で上書きされる範囲」の印としても働く。守る単位はタブごとに違う。

| タブ | 守る単位 | 理由 |
| --- | --- | --- |
| 交通IC | 欄 | 欄が固定なので1対1で対応が付く |
| 会議候補日設定 | 全部（反映は**加算**） | カレンダーでは職員が選んだものが目に見えている。置き換えると自分のクリックが消える。既に埋まっている位置に来た候補日程だけを見送り、`ApplyReport.skipped` で言う（#69。行のフォームだった頃は「作り直しで手を入れた行を残す」だった） |
| 参加可否回答 | 候補日程（参加可否と備考を別々に） | 手で選んだ可否は本人の予定そのもの。備考は印が参加可否側にしか無いので出どころを別に持つ（持たないと保護から漏れる） |
| 候補日提案 | 開催日と予備日の選択（まとめて1つ） | AI が埋めるのは評点と根拠だけ。開催日と予備日は「この日程で開く」1つの判断の表裏なので、候補日程ごとに印を持つと AI 由来の予備日を外した跡が残らず次の提案で復活する |

触らなかった分は `ApplyReport` に載せて出す。当てる先が画面から消えていて反映できな
かった分（`dropped`）と、当てる先が既に埋まっていて見送った分（`skipped`。加算のタブ
だけに起きる）も同じ経路で出す — 黙って落とすと、指示が届かなかったのと
見分けが付かない。抽出系3タブは反映を押した後に、候補日提案タブは AI提案バナーの下に
添える（`ApplyReportView`）。

## プレビューを挟んでから反映する（#65 / ADR-0006）

**応答が来てもフォームは変わらない。** 抽出系3タブは結果をプレビューに出し、職員が
「この内容でフォームに入力」（文言はタブごと）を押したときだけ `onApply` が走る。
撤回したのは「受信と同時に書き込んで事後報告する」形 — 事後報告は「何が変わったか」を
伝えるが、「変えるかどうか」を職員に選ばせない。**タブ4は対象外**（AI入力アシスタントを
使わない）。

3つの表示が同じことを言っているように見えるので、担当を分けておく。

| | 何を言うか | いつ |
| --- | --- | --- |
| プレビューの一覧（`AiPreview`） | 押したら**何が入るか** | 応答が届いた後、反映の前 |
| `message`（出力契約） | モデルが書いた文 | 同上。画面が反映したかどうかは保証しない |
| `ApplyReport`（`ApplyReportView`） | 実際に**何が入ったか** | 反映を押した後 |

**メッセージの見た目は結果から導く**（`previewTone`）。契約にフラグを足さない — 埋まって
いないのに「埋まった」と申告された応答を画面が信じてしまうため。青が通常、黄が聞き返し
（一覧が空、または1行でも埋まらなかったとき）、赤は `AiErrorCode` が返ったときだけ。
「もう一度押しても同じ」が赤、「情報を足せば進む」が黄。赤は別立て（`AiErrorNotice`）で、
**前の往復のプレビューが残っていれば同時に出る** — それが見比べながら書き直せるということ。

**プレビューは「押したら入るもの」だけを緑のチェックで並べる。** 手で入れた欄は反映しても
変わらないので、錠の印と「手入力のため変更しません」で分ける（判定は `applyToForm` /
`applyAvailabilityResult` と同じ条件を引く。2箇所に書くとプレビューが嘘になる）。押しても
何も変わらないときは反映のボタンを無効にする（`hasApplicableItems`）— 押させても
「フォームは変わっていません」と報告してアシスタントが縮むだけになる。

**会話ログは持たない。** 往復のたびにプレビューを積むと、一度も反映されなかった結果に
緑のチェックが並ぶ一覧になり、フォームに入っているものと見分けが付かない。セッションが
続いていることは往復数で出す（#38 が会話ログで見せていたもの）。

生成中・失敗・反映の報告は**折りたたみの内側に置かない。** 3つとも縮んだ状態で起きうる
（反映は自分で縮め、`MAX_CONSECUTIVE_FAILURES` 回続けて失敗すると縮む）ので、内側に置くと
結果が出た瞬間に隠れる。縮めるときはフォーカスも非AI経路のフォームへ移す — 押したボタンごと
`hidden` の内側に入るので、行き先を指定しないと `<body>` へ落ちる。

`onApply` / `onReset` は `AiAssistant` の中で ref に写して最新のものを呼ぶ。応答を待つ間に
職員がフォームを触ると、実行中のクロージャが掴んでいる古い関数が編集前の状態を見て上書きの
可否を決めてしまい、待っている間の手入力を踏み潰す。プレビューを挟むと写す時点が「職員が
押したとき」まで伸びるので、この必要はむしろ強くなった。

同じ理由で送信ごとに連番（`submitSerial`）を振り、応答が返る前に「最初からやり直す」か
「中断」が押されたらその結果を捨てる。あわせて `AbortController` で実際に止める
（`@/lib/api.ts` の `signal`）— 捨てるだけでは Runtime は最後まで推論する。待つ上限は
`REQUEST_TIMEOUT_MS`（60秒）で、打ち切りは `TIMEOUT` として返る。**後片付けは本文を
読み終えるまで掛ける** — `fetch` の解決で解除すると、ヘッダだけ届いて本文が来ない経路で
上限が効かない。

**「中断」と「最初からやり直す」は別の操作。** 前者は待つのをやめるだけで会話もフォームも
残す。後者は空にするので、出ているものが1つも無い初回の送信中は現れない — 中断をそこに
乗せると、初回の推論を止める手が画面のどこにも無くなる。

既知の穴: 「消す」で空にした AI 由来の欄は次の反映で埋め直される（空欄は初期状態と
区別が付かない）。分けるには `FieldSource` に3つ目の状態が必要で、3タブすべての印の意味が
変わるため第1段では踏み込まない。

出力契約は `src/lib/contracts/` に自己完結で持つ（#109。リポジトリルートの `contracts/`
への依存は無い）。経緯はリポジトリルートの `CLAUDE.md`「入出力契約」節と ADR-0011。

## デザイントークン（#73）

設計書に出てくるクラス名がそのままコードに現れるよう、`src/app/globals.css` の `@theme` に色24個・
タイポグラフィ8個を置いている。**デジタル庁デザインシステム（DADS）の名前を借りているだけで
値は DADS のものではない** — 理由は `globals.css` のコメント。設計書に無いトークンを足さない
（使われないトークンは「設計書にある」の証拠にならない）。

設計書は明るい面だけで書かれているので、`prefers-color-scheme: dark` の反転は持たない。
`dark:` 変種を書くと、トークンで塗った面だけが明るいまま浮く。

アイコンは `lucide-react`（**dependency**。ブラウザへ配られるので devDependency ではない）。

## Commands

- 依存インストール: リポジトリルートで `pnpm install`（pnpm workspace のメンバー。ADR-0015）
- 開発サーバー: `pnpm run dev`
- ビルド: `pnpm run build`
- Lint: `pnpm run lint`（ESLint。`eslint.config.mjs`）
- Format: `pnpm run format`（チェックのみ: `pnpm run format:check`）
- テスト: `pnpm run test`（vitest。対象は判断を持つ `.ts`。テストは対象の隣に置く）

`typecheck` スクリプトは未定義（`hono-app` とは非対称）。型検証は `pnpm run build` が兼ねている。

**`.tsx` は描くだけ。判断を持つ `.ts` はテストする。`.tsx` に判断が育ったら、テストを書くの
ではなく隣の `.ts` へ出す。**（#23 Testing Decisions の線引きを #67 で言い直し、`app/lib` の
解体に合わせて ADR-0016 で拡張子ベースへ移したもの。**テストは対象の隣に置く。**）

線引きは**画面を描かないと確かめられないかどうか**にある。判断を持つ `.ts` は、生成ロジック
（`availability-table.ts`）・表示文字列と導出（`meeting-info.ts`, `availability-form.ts`,
`recommend-form.ts`, `reservation-form.ts`, `candidates-form.ts`, `candidate-calendar.ts`）・
エラーの案内（`error-guidance.ts`）・プレビューの語彙（`ai-preview.ts`）で、どれも入力と
出力が値で閉じている。
JSX の中に埋めたままだと、区切りを変えても終わる時刻の計算を間違えても、誰かが動かして見ない
限り気付かない。
**フック（`use-*.ts`）は `.ts` でも `.tsx` と同じ側に立つ** — React の状態そのもので、
判断は隣の純関数へ出してある（`use-candidate-calendar.ts` は受け付けの梯子を
`candidate-calendar.ts` に、加算を `candidates-form.ts` に委ねる）。

コンポーネントを書かないのは #23 の方針のまま。出力契約からフォーム状態への写像を素直な代入に
留め、デモは手動で確認する。写像に条件分岐が育った時点で見直す。

`@contracts/*` の tsconfig エイリアス・`next.config.ts` の `turbopack.root`（どちらも
`contracts/` がプロジェクトの外にあったための回避策）は削除した（#109）。**`@/*` は
`tsconfig.json` と `vitest.config.mts` の両方が `src` を指す**（ADR-0016 で初めて意味を持った）。

`src/lib/contracts/meeting.ts` / `recommendation.ts` / `prompt-requirement.ts` は、画面が
値として実行時に要る値域・導出ロジックを持つので**zod を import しない**（同じ理由で
`src/lib/contracts/types.ts` は zod を持たない素の TypeScript 型として置く）。
`src/lib/contracts/schemas.ts` だけが例外で zod を値として持つが、これを値として引くのは
`availability-table.test.ts` だけ（`.tsx` からは引かれない）なので SSG のバンドルには
乗らない。

### lint と format で別ツールを使っている理由

- **lint = ESLint**: `eslint-config-next` の core-web-vitals 系ルール（`no-img-element`,
  `no-html-link-for-pages` 等）に biome の等価物が無いため、biome に置き換えると検査を失う。
- **format = Biome**: `eslint-config-next` は整形を行わない。他プロジェクト（`app/FormEchoAgent`,
  `hono-app`）と揃えて biome を使う。
- `biome.json` の `linter.enabled` は **false**。有効にすると biome と ESLint が同じコードを
  別基準で lint して衝突する。この理由から `format:check` も他プロジェクトの `biome check .`
  ではなく `biome format .`（lint を含まない）にしている。
- `biome.json` の `css.parser.tailwindDirectives` は **true** が必須。無いと Tailwind v4 の
  `@theme` / `@custom-variant` を biome の CSS パーサーが解釈できず `src/app/globals.css` で落ちる。
- `biome.json` は JSON with comments を受け付けない（コメントを書くと設定全体が無視され既定値に
  フォールバックする）。設定意図はこのファイルに書くこと。

## 言語方針

本プロジェクト（FormEcho 全体）は**日本語を基本言語**として運用します。詳細は `../CLAUDE.md` の「言語方針」セクションを参照してください。

簡潔に：
- **Git コミット・コードコメント・ドキュメント**: すべて日本語
- **スキルのフォーマット**: 各スキルに従いながら、記述は日本語
- **AGENTS.md は手編集不可**: `next dev` が自動生成するため
