# コードコメント作成ガイド

本プロジェクトでは、コードコメントを**日本語**で記述します。

## 原則

- **WHAT ではなく WHY を書く**: コードを読めば何をしているかは分かるので、*なぜ* その実装にしたのかを重視
- **1 行以下**: 多行コメントは避け、簡潔に
- **非自明なロジックのみ**: 単純な処理にはコメント不要

## パターン

### ✅ 良い例

```typescript
// Bedrock がレート制限中の場合、指数バックオフで再試行
// (即座に再試行するとエラーが増えるため)
await exponentialBackoff(() => callBedrock(request))

// SEMANTIC 戦略はテキスト埋め込みベース
// → 意図抽出精度が高いが、初期インデックス作成に時間がかかる
const memoryStrategy = 'SEMANTIC'
```

### ❌ 避ける例

```typescript
// 配列に要素を追加
items.push(newItem)

// for ループで反復処理
for (const item of items) {
  process(item)
}

// ユーザー ID を取得
const userId = getUserId()
```

## 言語固有

### TypeScript / JavaScript

```typescript
// OAuth token が 5 分以内に期限切れの場合、先に更新
// (API 呼び出し直前に失敗するより、事前に確保する方が信頼性が高い)
if (isTokenExpiringSoon(token)) {
  await refreshToken()
}
```

### Python (Strands SDK agent)

```python
# 複数の tool call が並行実行される場合、state が競合する可能性あり
# → 各 tool に独立した state 空間を割り当て
state_namespace = f"tool_{tool_id}"
```

## ADR・仕様書との連携

複雑な仕様や設計判断が関わる場合、ADR や仕様書を参照:

```typescript
// See ADR: メモリー戦略を SEMANTIC に統一
const strategy = config.memory.strategy
```

## Commit メッセージとの違い

| 対象 | 目的 | 言語 |
|---|---|---|
| **コードコメント** | 実装者向け (コードの "なぜ") | 日本語 |
| **Commit メッセージ** | 変更履歴 (何が変わったか・なぜか) | 日本語 |
| **Code review コメント** | レビュアーから実装者へ (改善提案) | 日本語 |
| **ドキュメント** | ユーザー・保守者向け | 日本語 |
