import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本番は CloudFront + S3 に静的ファイルを置き、ブラウザから ALB 上の BFF を
  // 直接叩く構成になる。同じ形をローカルでも保つため SSG に固定する。
  // これに伴い Next.js の rewrites は使えない（SSG では機能しない）ので、
  // API のベース URL は公開環境変数で与える。
  output: "export",
};

export default nextConfig;
