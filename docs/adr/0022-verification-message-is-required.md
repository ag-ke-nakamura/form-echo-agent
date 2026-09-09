# 検証メッセージを必須にし、空白だけの自然文は書かれなかったものとして扱う

- **Status**: accepted
- ADR-0020 の「検証メッセージは空でもよい」を改訂する

## 決定

2つ決めた。

- **`playground.free-prompt` の検証メッセージ（`prompt`）を必須にする。** 持ち込み
  システムプロンプトだけを送る形は取れない。判断は `PROMPT_REQUIREMENT` が持ち、
  画面の送信ボタン・BFF の門・Runtime の入力契約の3つがそこから引く
- **空白だけの `prompt` は「書かれなかった」として扱う。** 弾かずに無かったことにし、
  **5タスクすべてに掛ける。** BFF は画面から来る値に対して既にこの正規化を持っていた
  ので、Runtime の `aiTaskRequestSchema` にも同じ判断を置く

## なぜ

**空でも投げる形は実機で成立しない。** 検証メッセージが空だと user message が空の text
ブロック1つとしてモデルへ飛ぶが、Bedrock の Converse はこれを `ValidationException` で
弾く（`The text field in the ContentBlock object at messages.N.content.M is blank.`）。
職員には原因の分からない失敗にしか見えない。**空文字も空白だけも同じ「blank」判定**
なので、`z.string().min(1)` では足りない。

Runtime 側にも正規化を置くのは、**この Runtime が curl で直接叩かれるため**である。
`agentcore dev` の備え付け UI は `taskId` を付けられずこの Runtime を動かせないので
（`.claude/rules/agent-app.md`）、プロンプトを試す手段は画面か curl の2つしかない。
画面だけで止めると、塞ぎたかった失敗そのものが curl で再現する。

**弾かずに無かったことにする**のは、弾く側に倒すと任意の taskId の回まで巻き添えに
するからである。空白だけの追加指示は、いまは `## 職員からの追加指示` の見出しだけが
立った本文を作る — `user-message.ts` が「見出しだけが立つと、モデルは書かれていない
指示を探す」と警告している状態そのもので、これも「書かれなかった」に倒せば消える。

## Considered Options

- **Runtime が空のときだけ最小の user message を補う**（「上記の指示に従ってください」
  等）: ADR-0020 の「我々が黙って足すものはすべてノイズになる」に正面から反する。
  職員が見ているのが「自分が書いた文の効き」でなくなる度合いは、Skill を混ぜるのと
  変わらない。**親切な誰かが再提案しやすい案なので、却下したことを書き残す**
- **画面だけで送信を止め、契約は `optional` のままにする**: curl で直接叩かれる経路が
  残る。上の「なぜ」のとおり
- **空白だけの `prompt` を `INVALID_INPUT` で弾く**: 必須なのは `playground.free-prompt`
  だけなので、他4タブで今まで通っていた回を落とすことになる

## Consequences

- **未文書化の挙動に依存している。** AWS は `ContentBlock.text` に長さ制約を書いておらず、
  「blank を弾く」はドキュメントに無い（botocore の issue で AWS が `service-api` として
  扱った報告と、複数の再現報告が根拠）。確認できているのは Claude 経由のみ。AWS が
  この検査を外したら、この決定の前提は消える — そのとき戻すかどうかは別途判断する
- **ADR-0020 が1欄案を却下した理由から「2欄あれば user message を空にして1欄を再現
  できる」が落ちる。** 却下理由は「同じ user message に対して system prompt を差し替えて
  比べる使い方が1欄ではできない」の1本になる。こちらは無傷である
- **`contracts/task-input.ts` の「`prompt` の正規化は呼び出し側が行う。契約の関心事では
  ない」を覆した。** 正規化そのものは依然として `checkTaskInput` の外（BFF と Runtime の
  それぞれの入口）にあるが、「Runtime は正規化しない」という前提は消えた
- 空白だけの `prompt` を任意の taskId へ送ると、以前は `INVALID_INPUT`（`min(1)` は空文字
  だけを弾くので、正確には空文字のときだけ）だったものが「指示なし」として通るように
  なる。BFF がこの正規化を先に済ませるため、画面から見える振る舞いは変わらない
