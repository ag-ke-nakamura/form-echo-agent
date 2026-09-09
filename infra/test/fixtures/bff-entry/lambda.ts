/**
 * テスト用の BFF エントリ（`bffEntry` プロップのフィクスチャ）。
 *
 * 本物（`hono-app/src/lambda.ts`）を指すと、synth のたびに AWS SDK ごと esbuild で
 * 束ねる時間を払い、`hono-app` の node_modules も要る。ここが検証するのは
 * テンプレートの形なので、束ねる対象は何も import しないもので足りる。実際の
 * エントリが束ねられるかは CI の `cdk synth` が見る。
 */
export const handler = () => ({ statusCode: 200 });
