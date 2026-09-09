# nextjs-app を feature-based 構成にする

- **Status**: accepted
- **Date**: 2026-09-09

`nextjs-app` は `app/` 直下にコンポーネント8ファイル、`app/lib/` にフラットな14ファイル、
`app/lib/contracts/` に契約を置いており、約10k行がファイル種別でしか仕分けられていない。
画面は4タブ（交通IC予約・会議候補日設定・参加可否回答・候補日提案）で、これが機能の単位
だが、**その境界はディレクトリのどこにも現れない。** 行数の偏りも見えない — 会議ロジ3タブで
約6,000行、交通IC は約830行である。

[bulletproof-react](https://github.com/alan2207/bulletproof-react) に倣い、`src/` を切って
**`src/features/ic-card/` と `src/features/meeting/` の2 feature** に分ける。`src/app/` は
ルートと組み立てだけを持ち、feature が跨いで使うものは `src/components/` `src/lib/` に置く。

## タブは4つだが feature は2つ

**4タブを4 feature にしない。** タブ2〜4（会議ロジ）は `meeting-info.ts`・`candidate-calendar.ts`・
`candidate-limit.ts`・`availability-table.ts`・`useCandidateCalendar`・`useMeetingInfo` を共有して
いる。4 feature にすると、これらが全部 feature 跨ぎになる。bulletproof-react は feature 間の
import を禁じるので、共有先は top-level の `components/` `lib/` しかない — **会議ドメイン固有の
ものが「共有」に溜まり、いま解こうとしているフラット構成が名前を変えて復活する。**

## feature の内側は画面優先

bulletproof-react の feature 内はファイル種別（`components/` `hooks/` `utils/`）だが、会議 feature
では**画面ごとに切る**。

```
src/features/meeting/
  candidates/    参加者が触る前の候補日程を決める画面
  availability/  候補日程に可否を答える画面
  recommend/     集まった可否から開催日を決める画面
  shared/        meeting-info（3画面が読む）・candidate-limit（2画面が読む）
```

種別優先にすると `utils/` に7ファイルが平坦に並び、**6,000行のほうで同じ問題が再発する。**
副次的な効き目として、`availability-table.ts`（実体はタブ4のモック。#58）が名前に反して
`recommend/` に入り、参加可否タブのものだという誤解が消える。

## テストの線引きが置き場所ベースから拡張子ベースへ

これまでは「`app/lib` の純関数はテストする / `app/*.tsx` は書かない。判断を持つコードが `.tsx` に
育ったら `app/lib` へ出す」という**置き場所ベース**の規則だった（#23 / #67）。`app/lib` を解体すると
この規則が宙に浮く。

**`.tsx` は描くだけ。判断を持つ `.ts` は必ずテストする。`.tsx` に判断が育ったら隣の `.ts` へ出す。**
現状の `app/lib/*.ts` = テスト対象 / `app/*.tsx` = 対象外と1対1で一致し、置き場所ベースと同じだけ
機械的で、テストを対象の隣に置く colocation とも噛み合う。

**フック（`use-*.ts`）だけは `.ts` でも `.tsx` の側に立つ。** React の状態そのもので、画面を描かないと
確かめられない。判断は隣の純関数へ出す — これは拡張子ベースの規則の例外ではなく、「画面を描かないと
確かめられないかどうか」という同じ線の当てはめである。

## 境界の強制

**ESLint 組み込みの `no-restricted-imports`** に glob を書く。feature 間を跨ぐ import は必ず
`@/` 始まりにすると決めたので、**import 文の文字列だけで判定でき、依存が要らない。**

- `src/features/**` → `**/features/**` を禁止（自分の feature 内は相対なので当たらず、
  `@/features/...` も相対で登った `../../features/...` も同じパターンが捕まえる）
- `src/components/**` `src/lib/**` → `**/features/**` と `**/app/**` を禁止

**構成そのものより、この線が本体である。** 線が無い feature-base はフォルダ名を変えただけで、
1年で崩れる。

## Considered Options

- **4タブ = 4 feature**: 上記のとおり、共有が top-level に溜まって元に戻る
- **ルートに分割し、Next.js の colocation で切る**: URL で何がどこか分かるが、タブ2〜3 は
  候補日程の状態を共有しており、遷移で消える。上げ先（クエリ / storage / Context）を作る
  別の変更が付いてくる。`form-echo-tabs.tsx` が狙っている「プロダクトオーナーがタブ切り替え
  だけで4機能を順に追える」も失う。**colocation と bulletproof-react は「使う場所の近くに置く」
  という同じ発想だが、colocation の軸はルートであり、この検証環境はルートが `/` 1本しかないので
  軸が1ノードに潰れる。** feature の内側では colocation を採る（テストを対象の隣に置く）
- **feature 内を種別優先にする**: bulletproof-react に素直だが、会議 feature で問題が再発する
- **`features/ai-assistant/` を第3の feature にする**: AI入力アシスタント一式は抽出系3タブが
  共有するので feature を跨ぐ。feature にすると禁止線に例外が要り、**次の「共有したい」でも
  例外が足されて線が意味を失う。** `src/components/ai-assistant/` に置く（`CONTEXT.md` の語を
  そのままディレクトリ名にするので、shared に置いても語と場所はずれない）
- **`eslint-plugin-import` の `import/no-restricted-paths`**: bulletproof-react と同じ形だが
  パスを解決するルールなので `eslint-import-resolver-typescript` も要り、依存が2つ増える。
  `@/` 規約がある間は文字列判定で足りる

## Consequences

- **`.claude/rules/contracts.md` の `paths` frontmatter を `nextjs-app/src/**/*` に直す。**
  直し忘れると、契約を触っている最中に規則が載らなくなる — これは黙って壊れる
- **ADR-0011 の「置き場所」と ADR-0015 の `api.ts` のパス記述をその場で直す。** 変わったのは
  パスという事実であって、ADR-0011 の判断（3プロジェクトが自己完結の複製を持つ）でも
  ADR-0015 の判断（応答封筒は Hono RPC で引く）でもない。**この ADR はどちらも改訂しない** —
  「改訂済み」の札が付くと、次に読む人が複製方針まで疑う
- **`nextjs-app/CLAUDE.md` の `app/lib` ファイル一覧を feature ごとの記述へ組み替える。**
  機械的な置換ではなく実質的な書き直しになる
- **`tsconfig.json` の `@/*` は `./src/*` へ、`vitest.config.mts` の別名も同じく。** どちらも
  現在1箇所も引かれていない（`@contracts/*` を消した #109 の残骸）ので、ここで初めて意味を持つ
- **3つに割って出す**: ①`src/` への移動とディレクトリ再編と import 修正だけ（ロジック変更ゼロ）
  → ②`no-restricted-imports` を入れる → ③会議の共有状態を `MeetingProvider` へ移す。
  ①は `git log --follow` で追える差分に留め、③だけが挙動を変えうるので単独にする
- **`CONTEXT.md` には何も足さない。** feature はコード構成の語であって業務ドメインの語ではなく、
  あそこは実装詳細を持たないグロッサリである
- **feature が増えたときも共有は shared へ上げる。例外は作らない。** 3つ目の feature が来て
  meeting と重い共有を持つなら、それは feature の切り方が間違っている合図として扱う
