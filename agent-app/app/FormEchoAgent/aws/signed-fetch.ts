import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import { AWS_REGION } from '../config.js';

/**
 * SigV4 で署名する `fetch`。
 *
 * 引数のサービス名で署名対象が決まる。Gateway を MCP で叩く経路（#46、
 * `bedrock-agentcore`）と、span を X-Ray の OTLP エンドポイントへ送る経路（#213、
 * `xray`）が共有する。**署名の落とし穴（下のコメント）を2箇所に持たないための共有**で、
 * 呼び出し側の都合が入り込む場所ではない。
 */
export function signedFetch(service: string): typeof fetch {
  const signer = new SignatureV4({
    service,
    region: AWS_REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : (input as Request | URL).toString(),
    );
    /*
      `host` を自分で入れる。SigV4 は署名対象に host を含めるが、`fetch` が付ける
      分は署名の時点ではまだ存在しない — 入れないと署名の中身と実際に飛ぶ
      リクエストがずれて 403 になる。
    */
    const headers: Record<string, string> = { host: url.host };
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });

    /*
      クエリは同じキーが複数回現れうるので配列で渡す。`Object.fromEntries` だと
      最後の1つに潰れ、署名が実際に飛ぶ URL と 食い違って 403 になる。
    */
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      query[key] = values.length === 1 ? (values[0] as string) : values;
    }

    /*
      本文は文字列のときだけ署名対象にする。`String(body)` で丸めると
      `[object Object]` を署名して実物と食い違う（MCP のトランスポートは JSON の
      文字列を送るので現状は通るが、丸める形だと壊れたときに 403 としてしか出ない）。
    */
    const { body } = init ?? {};
    if (body !== undefined && body !== null && typeof body !== 'string') {
      throw new TypeError(
        `SigV4 で署名できない本文の型です: ${Object.prototype.toString.call(body)}`,
      );
    }

    const signed = await signer.sign(
      new HttpRequest({
        method: init?.method ?? 'GET',
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname,
        query,
        headers,
        body: body ?? undefined,
      }),
    );
    return fetch(url, { ...init, headers: signed.headers });
  };
}
