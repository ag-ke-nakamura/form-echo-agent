import {
  type BaseModelConfig,
  type Message,
  Model,
  type ModelStreamEvent,
  type StreamOptions,
  type SystemPrompt,
  type Usage,
} from '@strands-agents/sdk';
import { FAKE_MODEL_NAME } from '../config.js';

/**
 * Bedrock に接続しないモデル。`FORMECHO_MODEL=fake` で選ばれる（#23 の決定性の確保）。
 *
 * 返す内容は台本（`fakeModelScript`）が持ち、モデル自身は判断を持たない。
 * 「AI の出力品質を assert しない」という #23 の線引きの裏返しで、**何を返すかは
 * テストが決める** — 守るのは配線・契約・エラー処理であって、モデルの賢さではない。
 */

/** 台本の1手。モデルが1回呼ばれるたびに先頭から1つ消費される。 */
export type FakeModelTurn =
  /** Structured Output のツールを呼ぶ。`output` はそのままツールの入力になる。 */
  | { kind: 'structuredOutput'; output: unknown; usage?: Usage }
  /**
   * 素のテキストで答える。Structured Output のスキーマが渡っているときは、
   * Strands がツールの使用を強制して1回だけやり直し、それでもテキストなら例外になる。
   */
  | { kind: 'text'; text: string; usage?: Usage }
  /** モデル呼び出しそのものが失敗する（接続断・スロットリング相当）。 */
  | { kind: 'error'; error: Error };

/** モデルが1回の呼び出しで受け取ったもの。Runtime が何を投げたかを外から見る窓。 */
export interface FakeModelCall {
  systemPrompt: SystemPrompt | undefined;
  messages: Message[];
  /** 渡ったツール仕様の名前。Structured Output のツールもここに現れる。 */
  toolNames: string[];
}

/** 台本が尽きたのにモデルが呼ばれた。 */
class FakeModelScriptExhaustedError extends Error {
  constructor(callCount: number) {
    super(
      `fake モデルの台本が尽きました（${callCount} 回目の呼び出し）。想定より多く呼ばれているか、台本が足りません。`,
    );
  }
}

const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Strands が Structured Output のために足すツールの名前。
 *
 * SDK の定数を import できないので写している。ずれたら台本が「ツール仕様が渡って
 * いません」で落ちるので、黙って別のツールを呼ぶことにはならない。
 */
const STRUCTURED_OUTPUT_TOOL_NAME = 'strands_structured_output';
/**
 * fake モデルが返すものと、受け取ったものの記録。
 *
 * WHY: モジュール変数として1つ持つ。`loadModel()` は引数を取らず、Agent は
 * セッションごとのキャッシュの中（invocation 境界の内側）で作られるので、
 * 呼び出し側から台本を渡す経路が無い。設定で差し替えると決めた以上、台本の
 * 受け渡しも設定と同じくプロセスの外側に置くことになる。
 */
class FakeModelScript {
  #turns: FakeModelTurn[] = [];
  #calls: FakeModelCall[] = [];
  #toolUseCount = 0;

  /** モデルが返すものを順に積む。 */
  write(...turns: FakeModelTurn[]): void {
    this.#turns.push(...turns);
  }

  /** 台本と記録を空に戻す。テストごとに呼ぶ。 */
  reset(): void {
    this.#turns = [];
    this.#calls = [];
    this.#toolUseCount = 0;
  }

  /** モデルが受け取った呼び出しの記録。古いものから並ぶ。 */
  get calls(): readonly FakeModelCall[] {
    return this.#calls;
  }

  /** 消費されずに残っている手の数。 */
  get remaining(): number {
    return this.#turns.length;
  }

  /**
   * 次の1手を取り出し、呼び出しを記録する。`FakeModel` だけが呼ぶ。
   *
   * 尽きたら例外にする。同じ手を返し続けると、契約に適合しない出力を
   * Strands が作り直させる経路が終わらない。
   */
  take(call: FakeModelCall): FakeModelTurn {
    this.#calls.push(call);
    const turn = this.#turns.shift();
    if (turn === undefined) {
      throw new FakeModelScriptExhaustedError(this.#calls.length);
    }
    return turn;
  }

  /** ツール使用の ID。台本と同じく `reset()` で戻るので記録が決定的になる。 */
  nextToolUseId(): string {
    this.#toolUseCount += 1;
    return `fake-tool-use-${this.#toolUseCount}`;
  }
}

export const fakeModelScript = new FakeModelScript();

export class FakeModel extends Model<BaseModelConfig> {
  // ログと実測で実物と見分けが付くようにしておく。Bedrock には存在しない ID。
  #config: BaseModelConfig = { modelId: FAKE_MODEL_NAME };

  updateConfig(modelConfig: BaseModelConfig): void {
    this.#config = { ...this.#config, ...modelConfig };
  }

  getConfig(): BaseModelConfig {
    return this.#config;
  }

  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    const toolSpecs = options?.toolSpecs ?? [];
    const turn = fakeModelScript.take({
      systemPrompt: options?.systemPrompt,
      // 呼ばれた時点の履歴を控える。Agent は同じ配列を使い回すので複製する。
      messages: [...messages],
      toolNames: toolSpecs.map((spec) => spec.name),
    });

    if (turn.kind === 'error') throw turn.error;

    yield { type: 'modelMessageStartEvent', role: 'assistant' };

    if (turn.kind === 'text') {
      yield {
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: turn.text },
      };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
    } else {
      /*
        呼ぶツールは渡された仕様から**名前で**選ぶ。位置で取ってはいけない —
        交通ICドメインエージェントは Web 検索も持つ（#46）ので、Structured Output の
        ツールが先頭に来る保証が無い。位置で取ると台本の出力が web_search の入力として
        渡り、原因の分からない失敗になる。
      */
      const toolSpec = toolSpecs.find(
        (spec) => spec.name === STRUCTURED_OUTPUT_TOOL_NAME,
      );
      if (toolSpec === undefined) {
        throw new Error(
          `Structured Output を返す台本ですが、${STRUCTURED_OUTPUT_TOOL_NAME} のツール仕様が渡っていません（渡ったもの: ${toolSpecs.map((spec) => spec.name).join(', ') || 'なし'}）`,
        );
      }
      yield {
        type: 'modelContentBlockStartEvent',
        start: {
          type: 'toolUseStart',
          name: toolSpec.name,
          toolUseId: fakeModelScript.nextToolUseId(),
        },
      };
      yield {
        type: 'modelContentBlockDeltaEvent',
        delta: {
          type: 'toolUseInputDelta',
          input: JSON.stringify(turn.output),
        },
      };
      yield { type: 'modelContentBlockStopEvent' };
      yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' };
    }

    yield {
      type: 'modelMetadataEvent',
      usage: turn.usage ?? NO_USAGE,
      metrics: { latencyMs: 0 },
    };
  }
}
