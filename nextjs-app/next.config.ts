import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // 本番は CloudFront + S3 に静的ファイルを置き、ブラウザから ALB 上の BFF を
  // 直接叩く構成になる。同じ形をローカルでも保つため SSG に固定する。
  // これに伴い Next.js の rewrites は使えない（SSG では機能しない）ので、
  // API のベース URL は公開環境変数で与える。
  output: "export",
  turbopack: {
    /*
      出力契約（`contracts/`）はこのプロジェクトの外にある。Turbopack は
      プロジェクトフォルダの外を読まないので、リポジトリルートを root として渡す。
      tsconfig の `paths` だけでは型検査しか通らない（型としてしか使わない import は
      実行時に消えるので、値として引くまで露見しなかった）。

      `resolveAlias` に絶対パスを与える方法と `contracts` への symlink はどちらも
      効かない（実体がプロジェクトの外にあることは変わらないため）。
    */
    root: join(projectRoot, ".."),
  },
};

export default nextConfig;
