# Guardrail チェックを BFF ではなく Runtime に置く

- **Status**: accepted
- **Date**: 2026-09-03

参照アーキテクチャ（`temp/00-arch-design.md` 3.2節「BFF 層の防御」）は、入力サニタイズ・taskID 判定・認可チェックとあわせて Guardrail による入力検証を BFF（apps/api）の責務としている。本検証環境ではこれを**意図的に外し、Guardrail チェックを AgentCore Runtime 側に置く**。AI 処理の責務を Runtime に集約し、BFF を「検証と転送」だけの薄い層に保つため。

BFF に残すのは参照ドキュメント 10.1節・10.2節に相当する部分だけ（入力長制限、taskId 許可リスト照合、XSS 対策の基本的なサニタイズ）である。マイナンバー等の日本固有 PII を検知する正規表現も Runtime 側に置く。

## Considered Options

- **BFF で呼ぶ（参照アーキ通り）**: Runtime に到達する前に落とせるので、ブロック時に Runtime の起動コストとモデルのトークンを消費しない。ただし AI に関する判断が BFF と Runtime の2箇所に分散する
- **Runtime で呼ぶ（採用）**: モデル呼び出しの直前・直後という、判断に必要な文脈が全部揃っている場所で検査できる。AI の統制がすべて Runtime のコードに集まる
- **入力を BFF、出力を Runtime**: 早期遮断と出力検査の両立。ただし責務が最も分散する
- **両方に入れる**: 二重課金

Runtime 内では、モデル呼び出しの**前**に `ApplyGuardrail` を呼ぶため、ブロック時にモデルのトークンは消費しない。BFF に置く場合のコスト優位は Runtime の起動分に縮む。

## Consequences

- 参照アーキでは Runtime を呼べるのは BFF の ECS タスクロールだけ（VPC Endpoint + SigV4、3.3節）なので、BFF を素通りして Runtime が叩かれる経路は実質存在しない。この配置で防御の穴は開かない
- Runtime 実行ロールに `bedrock:InvokeGuardrailChecks`（リソースレスのため `Resource: "*"`）と `bedrock:ApplyGuardrail` が必要になる。参照ドキュメント 3.3節の権限一覧は更新が必要（`docs/reference-doc-fixes.md` F-08）
- Strands の Structured Output はスキーマをツール仕様に変換して実装されるため、Guardrail の sensitive information filter は**出力を検査できない**（`toolUse.input` を評価しない）。出力側の検査は Structured Output のパース直後にアプリケーション層で行う（同 F-16）
- 本番へ移す際、この配置を BFF 側へ戻すにはコードをサービス間で移動する必要がある
