import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { Model } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import {
  AWS_REGION,
  bedrockModelId,
  FAKE_MODEL_NAME,
  resolveModelName,
} from '../config.js';
import { FakeModel } from './fake.js';

export function loadModel(): Model {
  const name = resolveModelName();
  // fake は Bedrock に接続しない差し替え（#23 の決定性の確保）。テストと実測は
  // 同じ invocation 境界を通り、違うのはこの設定だけにする。
  if (name === FAKE_MODEL_NAME) return new FakeModel();

  return new BedrockModel({
    modelId: bedrockModelId(name),
    // 環境の AWS_REGION に依らずリージョンを固定する。`jp.` の推論プロファイルは
    // ap-northeast-1 でしか解決できず、取り違えると実行時まで気付けない。
    region: AWS_REGION,
    // ConverseStream ではなく Converse を使う。参照ドキュメント 1.3節の API 仕様が
    // 一括の JSON で、逐次テキストを受け取る相手がこの構成には存在しないため。
    stream: false,
    clientConfig: {
      // HTTP/1.1 を明示する。
      //
      // WHY: @aws-sdk/client-bedrock-runtime は双方向ストリーミングの API を持つため、
      // クライアント全体の既定リクエストハンドラが NodeHttp2Handler になっている。
      // 開発機のネットワークが Bedrock へ HTTP/2 を張れず ERR_HTTP2_ERROR になる
      // 事例を実際に踏んだ（同じ資格情報・同じモデルで HTTP/1.1 は通る）。
      // stream: false により単発の Converse しか投げないので、HTTP/2 の利点は無い。
      requestHandler: new NodeHttpHandler(),
    },
  });
}
