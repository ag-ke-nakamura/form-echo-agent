# 検証で答えの出た分岐を1つに畳む

- **Status**: accepted
- **Date**: 2026-09-08

この検証環境は、参照アーキテクチャ（ADR-032・共通設計方針書）が「実装時に選定」として並べた選択肢を実際に動かして選ぶために作った。そのため入力検証（案A `InvokeGuardrailChecks` / 案B `ApplyGuardrail`）と Skill 選択（`explicit` / `auto`）は**どちらも実装し、環境変数で独立に切り替えられる形**で持っていた。#44 の実測で両方に答えが出たので、**選ばれなかった実装と、それを切り替えるフラグをコードベースから削除する。**

**「畳む」とは、検証のために並べた複数の実装から1つを選び、残りの実装と切り替えフラグを削除することである。** 実装が元から1つで値が変わるだけの設定は対象にしない — `FORMECHO_MODEL`（`sonnet` / `haiku` / `fake`）、BFF の Runtime クライアント（`local` / `fake` / `deployed`）、Web 検索の有無は競合案ではなく役割の違う設定で、畳んでも何も単純にならない。区別しないと「選択肢を減らす」が「設定を減らす」に滑る。

畳むのは3つ。

- **入力検証 → 案A + 日本固有 PII 検知。** 案Bのコード経路（`guardrail/apply-guardrail.ts`）と `FORMECHO_GUARDRAIL_{INVOKE_CHECKS,APPLY_GUARDRAIL,CUSTOM_REGEX,ID,VERSION}` を削除する。`agent-app/infra` の Guardrail 実クラウドリソースも破棄する
- **Skill 選択 → `explicit`。** `auto`（`AgentSkills` プラグイン・`Skill` インスタンス化・`getActivatedSkills`）と `FORMECHO_SKILL_SELECTION_MODE` を削除する
- **しきい値 → 定数。** `FORMECHO_GUARDRAIL_THRESHOLD_*` の env 上書きを落とす（誰も設定しておらず、値は #44 で決まっている）

## Considered Options

- **案A + 日本固有 PII 検知（採用）**: #44 は「どちらか一方では足りない」形の答えを出した — 案Aは Prompt Attack を日英とも 8/8 でブロックするがマイナンバーを 0/8 しか検知せず、案Bはその逆（日本語 Prompt Attack 0/8、マイナンバー 8/8）。**案Bの唯一の勝ちであるマイナンバーは `guardrail/pii.ts` の正規表現が代替できる**ため、案Bを残す理由が消える
- **案B + 日本固有 PII 検知（却下）**: マイナンバーの検知が二重になるうえ、日本語の Prompt Attack が丸ごと落ちる。Classic Tier の prompt attacks が英仏西のみという Tier の制約（F-04・F-15）で、設定では解けない
- **3経路すべてを常時有効にする（却下）**: フラグは消えるが実装は3つ残る。案Bのために Guardrail リソースと `bedrock:ApplyGuardrail` 権限を維持し続けることになり、採用していない経路を本番相当で動かせる状態が残る
- **フラグを残したまま既定値だけ固定する（却下）**: 「1つに絞る」を達成しない。切り替え先の実装が生き続けるので、次に触る人は3経路すべてを読む必要がある
- **Skill 選択を `auto` に寄せる（却下）**: #44 の的中率は 6/6 だったが、**この4機能は呼び出し元の画面が taskId を最初から知っている**（`parse-candidates` と `parse-availability` は別の画面から呼ばれる）。AI に推測させても得るものが無く、曖昧な入力での取り違えという実測していない下振れリスクを新たに背負うだけになる（F-09）

## Consequences

- **実測の再現性を意識的に手放す。** 計測スクリプト（`tests/measure-*.ts` 4本）は畳む対象そのものを片腕として使っており、フラグを消すと動かない — `measure-guardrail.ts` の `setLayers()` は実行中に `process.env.FORMECHO_GUARDRAIL_*` を書き換えて案A単体・案B単体を作り分けていた。スクリプトと `measurement-inputs/` を削除し、`docs/reference-doc-fixes.md` の各実測節に「`61a482e`（PR #118）時点のコードで実施」と記す。再現したい者は `git checkout 61a482e` する
- **フラグの唯一の消費者が計測スクリプトだった。** `FORMECHO_GUARDRAIL_{INVOKE_CHECKS,APPLY_GUARDRAIL,CUSTOM_REGEX}` と `FORMECHO_SKILL_SELECTION_MODE` を設定している場所は `tests/measure-*.ts` 以外に存在しない。畳むことで消えるのは分岐だけで、運用上の切り替え能力は失わない
- **ADR-0001 は Decision が成立し続ける。** 訂正は2箇所 — 呼ぶ API 名（`ApplyGuardrail` → `InvokeGuardrailChecks`。「モデル呼び出しの前に呼ぶのでブロック時にトークンを消費しない」というコスト論の結論は案Aでも同じ）と、不要になる `bedrock:ApplyGuardrail` 権限。逆に「日本固有 PII を検知する正規表現も Runtime 側に置く」は `FORMECHO_GUARDRAIL_CUSTOM_REGEX` が消えて常時有効になり確定する
- **ADR-0010 は Decision が成立し続けるが、約束が1つ取り消しになる。** 「Guardrail を実際にデプロイする回で `bedrock:ApplyGuardrail` 権限をまとめて追加する」はこの ADR により**永久に来ない**。あわせて「参照先の Guardrail が未デプロイ」という前提は現在すでに偽（F-28 が実機で確認済み）。スタックに残るのは案Aの `bedrock:InvokeGuardrailChecks` 付与（#116）だけになり、当初の対象だった Guardrail はリソースごと消える。Runtime 実行ロールへの IAM 付与は `agentcore.json` で宣言できないので、独立スタックである理由自体は変わらない
- **ADR-0012 は明文の一文だけを取り消す。** 「`#42` が導入した2モード設計自体は変えない」がこの ADR で成立しなくなる。Decision（Skill の本文を TypeScript のデータとして持つ）は無傷で、むしろ単純になる — `Skill` インスタンス化の呼び出し元が消えるため `SKILLS` は `Record<TaskId, string>`（`instructions` の文字列だけ）にでき、`@strands-agents/sdk/vended-plugins/skills` への依存が Runtime から消える。`SkillConfig` の `instructions` が optional だったことに由来する `loadSkill` の `?? ''`（instructions の無い Skill が来たら黙って空の system prompt を作るフォールバック）も、自前の型で必須にすることで消える
- **`.claude/rules/agent-app.md` と `.claude/rules/formecho-agent-testing.md` を同じ変更で直す。** rules ファイルは対象パスを触っている最中に自動で載る仕組みなので、削除した案Bと `auto` の説明を持ったまま main に入ると、収束後に `agent-app/` を触る者の context に存在しない実装の説明が載る
- **`agent-app/infra` の Guardrail 破棄は人が実行する。** 実クラウドリソースの削除であり、CDK からの定義削除とあわせて別の作業単位に分ける
- **案Bを再評価するには Guardrail リソースを作り直す必要がある。** F-16（`toolUse.input` が `sensitiveInformationPolicy` に評価されない）の実測もこのリソースを土台にしていたため、同じ確認をやり直すなら `61a482e` のコードとリソースの再作成が要る。本番設計が Classic Tier を選ぶ場合に払うコストであり、この検証環境では払わない
