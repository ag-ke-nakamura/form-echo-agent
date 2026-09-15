import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { resolveTracesEndpoint } from '../config.js';
import { xraySpanExporter } from './xray-exporter.js';

/**
 * GenAI Observability の画面に出る名前。
 *
 * **`OTEL_RESOURCE_ATTRIBUTES` では渡さない。** あの環境変数は AgentCore がホスト時に
 * 入れる `aws.log.group.names` と `cloud.resource_id`（ダッシュボードへの紐付けそのもの）
 * を丸ごと上書きしてしまう。
 */
const SERVICE_NAME = 'FormEchoAgent';

/**
 * トレースを有効にする（#213）。**送り先が無ければ何もしない。**
 *
 * Strands は span を自分で発行し、**グローバルに登録済みの TracerProvider を黙って使う**
 * （ドキュメントの Option 1）。したがってここでやることは provider を1つ組んで登録する
 * ことだけで、`setupTracer()` も Agent 側の設定も要らない。
 *
 * `AWSXRayIdGenerator` を使うのは、X-Ray が trace ID の先頭4バイトに epoch 秒を要求する
 * ため。標準の乱数 ID のままだと送信自体は通っても取り込みで弾かれる。
 */
export function setupTracing(): void {
  const endpoint = resolveTracesEndpoint();
  if (endpoint === null) return;

  const provider = new NodeTracerProvider({
    idGenerator: new AWSXRayIdGenerator(),
    resource: resourceFromAttributes({ 'service.name': SERVICE_NAME }),
    spanProcessors: [new BatchSpanProcessor(xraySpanExporter(endpoint))],
  });
  provider.register();
}
