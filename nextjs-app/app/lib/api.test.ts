import { afterEach, expect, it, vi } from "vitest";
import { RESERVATION_TASK_ID } from "./api";

/**
 * 素の `fetch` から `hc` へ移した経路（#136）が、BFF まで従来どおり届くかを見る。
 * 型が保証しない部分（本文の中身・ベース URL の組み立て・signal）だけを対象にする。
 */

function stubFetch() {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    return new Response(
      JSON.stringify({
        sessionId: "s",
        result: {},
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        citations: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function callFetch(
  baseUrl: string,
): Promise<{ fetchMock: ReturnType<typeof stubFetch> }> {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", baseUrl);
  vi.resetModules();
  const fetchMock = stubFetch();
  const { requestAiTask } = await import("./api");
  await requestAiTask({
    taskId: RESERVATION_TASK_ID,
    prompt: "x",
    sessionId: null,
    input: undefined,
  });
  return { fetchMock };
}

async function requestedUrl(baseUrl: string): Promise<string> {
  const { fetchMock } = await callFetch(baseUrl);
  return String(fetchMock.mock.calls[0]?.[0]);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("空文字のベース URL では相対パスを叩く", async () => {
  expect(await requestedUrl("")).toBe("/api/ai/tasks");
});

it("ベース URL が絶対 URL ならそこへ足す", async () => {
  expect(await requestedUrl("http://localhost:8787")).toBe(
    "http://localhost:8787/api/ai/tasks",
  );
});

/**
 * 入力の門が素の `c.req.json()` のままなので、`$post` に渡す `json` は `AppType` に
 * 載らず型検査されない（ADR-0015）。**送られていること自体は型が保証しないので**
 * ここで見る。`input` が `undefined` のタスク（交通IC）では欄ごと落ちるが、BFF は
 * 欄の不在を「構造化入力なし」として読むので従来と同じ。
 */
it("BFF が読む欄をそのまま本文に載せる", async () => {
  const { fetchMock } = await callFetch("");
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  expect(JSON.parse(String(body))).toEqual({
    taskId: RESERVATION_TASK_ID,
    prompt: "x",
    sessionId: null,
  });
});

/**
 * 60秒の打ち切りと「中断」は `hc` の `init.signal` に載せている。素の `fetch` から
 * 移したときに落としやすいので、fetch まで届いていることを見る。
 */
it("打ち切りの signal が fetch まで届く", async () => {
  const { fetchMock } = await callFetch("");
  expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});

/**
 * CloudFront の OAC 経由で Lambda Function URL を叩くには、POST の本文ハッシュを
 * 呼び出し側が `x-amz-content-sha256` に載せる必要がある（#139。Lambda は
 * unsigned payload を受け付けない）。**落ちるとデプロイ済み環境でだけ 403 になり、
 * ローカルでは通るので手元では気付けない。**
 */
it("本文の SHA-256 を x-amz-content-sha256 に載せる", async () => {
  const { fetchMock } = await callFetch("");
  const init = fetchMock.mock.calls[0]?.[1];
  const body = String(init?.body);
  const expected = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  expect(new Headers(init?.headers).get("x-amz-content-sha256")).toBe(expected);
});
