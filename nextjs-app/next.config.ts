import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静的ファイルは CloudFront + S3 に置き、BFF は別プロセスとしてブラウザから
  // 直接叩く。デプロイ済み検証環境では同じ CloudFront の `/api/*` が BFF
  // （Lambda Function URL）に届くので、オリジンは1つ（ADR-0014、
  // `docs/architecture.md` §8）。同じ形をローカルでも保つため SSG に固定する。
  // これに伴い Next.js の rewrites は使えない（SSG では機能しない）ので、
  // API のベース URL は公開環境変数で与える。
  output: "export",
};

export default nextConfig;
