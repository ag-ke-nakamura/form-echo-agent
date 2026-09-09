import { afterEach, describe, expect, it } from 'vitest';
import { loadDomainTools } from './load.js';

/**
 * ドメインごとのツールの表（#46）。
 *
 * **「会議ロジに Web 検索を渡さない」はこのチケットの成果そのもの**なので、
 * 渡さないことを検証項目として置く（`docs/reference-doc-fixes.md` F-22）。
 * 実物の Gateway は叩かない — 見ているのは配線の選択だけである。
 */

const GATEWAY_URL =
  'https://formecho-example.gateway.bedrock-agentcore.ap-northeast-1.amazonaws.com/mcp';

function withGatewayUrl(url: string | undefined): void {
  if (url === undefined) delete process.env.FORMECHO_WEB_SEARCH_GATEWAY_URL;
  else process.env.FORMECHO_WEB_SEARCH_GATEWAY_URL = url;
}

afterEach(() => {
  withGatewayUrl(undefined);
});

describe('loadDomainTools', () => {
  it('Gateway が設定されていれば交通ICは Web 検索を持つ', () => {
    withGatewayUrl(GATEWAY_URL);

    expect(loadDomainTools('ic-card').map((t) => t.name)).toEqual([
      'web_search',
    ]);
  });

  it('Gateway が設定されていても会議ロジには渡さない', () => {
    withGatewayUrl(GATEWAY_URL);

    // 後回しではなく、そもそも不要（F-22）。候補日程の生成は入力文と基準日だけで
    // 閉じており、裏を取る対象が無い。
    expect(loadDomainTools('meeting')).toEqual([]);
  });

  it('Gateway が設定されていれば検証ドメインも Web 検索を持つ', () => {
    withGatewayUrl(GATEWAY_URL);

    // 交通ICと同じものを渡す（ADR-0020）。検索を使わせるプロンプトの効きを試せる
    // ことがプロンプト検証タブの値打ちの1つである。
    expect(loadDomainTools('playground').map((t) => t.name)).toEqual([
      'web_search',
    ]);
  });

  it('Gateway が未設定なら交通ICも検証ドメインも持たない', () => {
    withGatewayUrl(undefined);

    // 実測の Websearch 無効側がこの状態になる。
    expect(loadDomainTools('ic-card')).toEqual([]);
    expect(loadDomainTools('playground')).toEqual([]);
  });

  it('ap-northeast-1 以外の Gateway は受け付けない', () => {
    withGatewayUrl(
      'https://example.gateway.bedrock-agentcore.us-west-2.amazonaws.com/mcp',
    );

    // ADR-011。通すと検索クエリと結果が国外リージョンへ出たことに気付けない。
    expect(() => loadDomainTools('ic-card')).toThrow(/ap-northeast-1/);
  });
});
