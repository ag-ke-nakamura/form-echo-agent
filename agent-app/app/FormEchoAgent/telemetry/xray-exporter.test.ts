import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { xraySpanExporter } from './xray-exporter.js';

/**
 * X-Ray へ span を送るエクスポータ（#213）。
 *
 * **invocation 境界の外から確かめるしかない**（`.claude/rules/formecho-agent-testing.md`
 * の例外その4）。境界の応答に span は一切現れないので、署名が付いているか・本文が
 * OTLP の JSON になっているかは、境界越しにはどう転んでも言えない。**そして黙って
 * 壊れる**（誰も待っていない裏の経路なので、失敗しても画面は正常なまま）。
 *
 * AWS は叩かない。宛先はこのテストが立てるローカルのサーバーで、資格情報も
 * 環境変数の偽物を使う（`defaultProvider` は env を最初に見る）。
 */

/** 受け取ったリクエストを記録するだけのサーバー。 */
function recordingServer(status = 200): Promise<{
  url: string;
  requests: { authorization: string; contentType: string; body: string }[];
  close: () => Promise<void>;
}> {
  const requests: {
    authorization: string;
    contentType: string;
    body: string;
  }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({
        authorization: req.headers.authorization ?? '',
        contentType: req.headers['content-type'] ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(status).end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/v1/traces`,
        requests,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function span(name: string): ReadableSpan {
  // OTLP の直列化が読むのは以下の欄だけなので、`ReadableSpan` 全体は作らない。
  return {
    name,
    kind: 0,
    spanContext: () => ({
      traceId: '68e1b2f40000000000000000deadbeef',
      spanId: '0000000000000001',
      traceFlags: 1,
    }),
    startTime: [1789459970, 0],
    endTime: [1789459971, 0],
    status: { code: 0 },
    attributes: { 'gen_ai.system': 'strands-agents' },
    links: [],
    events: [],
    duration: [1, 0],
    ended: true,
    resource: { attributes: { 'service.name': 'FormEchoAgent' } },
    instrumentationScope: { name: 'test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

/** `export` はコールバックで結果を返すので、待てる形に変える。 */
function exportOnce(
  exporter: ReturnType<typeof xraySpanExporter>,
  spans: ReadableSpan[],
): Promise<ExportResultCode> {
  return new Promise((resolve) => {
    exporter.export(spans, (result) => resolve(result.code));
  });
}

describe('X-Ray への span 送信', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY =
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    /*
      **開発機の `AWS_PROFILE` を必ず外す。** 残っていると SDK がそちらを優先し、
      テストが各自のプロファイル（SSO の期限切れを含む）に依存する。CI では
      そもそも無いので、外さないと手元と CI で別のものを試すことになる。
    */
    delete process.env.AWS_PROFILE;
  });

  afterEach(() => {
    // `= undefined` は文字列 "undefined" を入れてしまうので消して戻す。
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const) {
      delete process.env[key];
    }
    if (saved.AWS_PROFILE !== undefined)
      process.env.AWS_PROFILE = saved.AWS_PROFILE;
  });

  it('SigV4 で署名した OTLP の JSON を POST する', async () => {
    const server = await recordingServer();
    try {
      const code = await exportOnce(xraySpanExporter(server.url), [
        span('invoke_agent'),
      ]);

      expect(code).toBe(ExportResultCode.SUCCESS);
      expect(server.requests).toHaveLength(1);
      const [request] = server.requests;

      /*
        署名が付いていること自体を見る。**これが抜けると本番で 403 になるだけ**で、
        手元では偽のサーバーが何でも 200 を返すため気付けない。
      */
      expect(request?.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      // 署名対象のサービスを取り違えると（`bedrock-agentcore` のままなど）同じく 403。
      expect(request?.authorization).toContain('/xray/aws4_request');
      expect(request?.contentType).toBe('application/json');

      // 本文が OTLP の形で、span の名前まで載っていること。
      const body = JSON.parse(request?.body ?? '{}');
      expect(JSON.stringify(body)).toContain('invoke_agent');
      expect(body.resourceSpans).toBeDefined();
    } finally {
      await server.close();
    }
  });

  it('宛先がエラーを返しても投げずに FAILED を返す', async () => {
    const server = await recordingServer(403);
    try {
      /*
        呼ぶのは `BatchSpanProcessor` で、**誰も結果を待っていない**。投げると
        未処理の rejection になり、トレースを出したいだけで Runtime を落としうる。
      */
      const code = await exportOnce(xraySpanExporter(server.url), [
        span('invoke_agent'),
      ]);
      expect(code).toBe(ExportResultCode.FAILED);
    } finally {
      await server.close();
    }
  });
});
