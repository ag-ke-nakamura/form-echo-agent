# Skill の本文を SKILL.md ではなく TypeScript のデータとして直接持つ

- **Status**: accepted
- **Date**: 2026-09-08

デプロイ済み Runtime（`build: CodeZip`）が `skill path does not exist or is not a valid skill directory` で起動時に落ちる（#45）。原因は Node の CodeZip パッケージャが esbuild の import グラフだけを束ね、`copySourceTreeSync` 相当の「非コードファイルをそのまま zip に含める」処理を持たないこと。`skills/**/SKILL.md` は import グラフに乗らないため、デプロイ済み zip に一切含まれない。

一度は `scripts/generate-embedded-skills.ts` が `SKILL.md` を読んで `skills/embedded.ts` に文字列として書き出し、`Skill.fromContent()` でパースする形にした（drift-guard として `embedded.test.ts` を添えた）。これは実際に動作したが、`SKILL.md`（人間が編集する一次情報）と `skills/embedded.ts`（生成物）という2つの実体が並存し、生成スクリプトで同期する構造そのものが受け入れられなかった。

**`SKILL.md` というファイル形式をやめ、Skill の本文（`name` / `description` / `instructions`）を TypeScript のデータとして直接書く。** 実体は1つになり、生成スクリプトも drift-guard テストも不要になる。

- 配置は `skills/{domain}/{task}/SKILL.md` から `skills/{domain}/{task}.ts` にフラット化する（1スキル1ファイルの対応は維持、ディレクトリだけ削る）
- 各ファイルはプレーンオブジェクト `{ name, description, instructions }` を export する。`Skill` インスタンス化は使う側に任せる — `invocation/domain-agent.ts` の `AgentSkills` プラグイン構築時にだけ `new Skill({...})` する。`invocation/system-prompt.ts`（明示モード）は `.instructions` を直接使い、`Skill` を経由しない（明示モードが要るのは文字列1本だけで、`Skill.fromContent(...).instructions` のような往復は無駄だった）
- `#42` が導入した2モード設計（`AgentSkills` プラグインによる自動モード、`buildSystemPrompt` による明示モードへの直接注入）自体は変えない

## Considered Options

- **`build: Container` に切り替える（却下）**: `skills/` はそのままイメージに含まれるが、`agentcore dev` がローカルでも `docker build` するため Docker デーモンが常に必要になる（実機で確認済み）
- **`SKILL.md` → 生成スクリプト → `skills/embedded.ts`（一度採用し、却下）**: 動作はしたが、一次情報（`SKILL.md`）と生成物（`embedded.ts`）が並存し生成で同期する構造自体が問題だった
- **Strands の Tool として書き直す（却下）**: Tool は決定論的な実行手段（明確な入出力を持つ API 呼び出し・コード実行）で、Skill が持つ「いつ・どの順序で・どのようなルールで Tool を使うか」という判断基準やドメイン知識を表現する役割とは補完関係にあり代替関係にない。既存の `web_search` Tool と各 Skill の関係がまさにこれで、Skill を Tool に置き換えると自動モードの発見・activation の仕組み（`AgentSkills` プラグイン）を自前で再実装する規模の変更になる
- **AWS Agent Registry を経由する（却下）**: 記事で確認できたのはチーム横断のカタログ／ガバナンス機能（登録・検索・承認ワークフロー）で、Runtime プロセスが実行時に本文を取り込む具体的な SDK 統合方法・VPC/IAM の要否は公開資料に記載が無い。2ドメイン・4スキルの規模でこれを採用するのは過剰で、未検証のまま採用すると新しいネットワーク依存（認証・レイテンシ）を抱え込む
- **Skill の本文を TypeScript のデータとして直接書く（採用）**

## Consequences

- `scripts/generate-embedded-skills.ts`・`skills/embedded.ts`・`skills/embedded.test.ts`・`package.json` の `generate:skills` スクリプトを削除する。生成・ドリフト検知という工程そのものが無くなる
- `skills/{domain}/{task}/SKILL.md` は `skills/{domain}/{task}.ts` に置き換わる。Markdown として素のエディタで読み書きする体験は失うが、内容（`name` / `description` / `instructions`）は変わらない
- Skill の本文（日本語のプロンプト文）が `.ts` ファイルに直接書かれる。`CLAUDE.md` の言語方針（日本語を基本言語とする）とは矛盾しない
- 将来、他チームと Skill を共有する必要が出た場合は AWS Agent Registry を再検討できるが、その時点で実行時取得の SDK 統合方法を Developer Guide で検証してから採用する
