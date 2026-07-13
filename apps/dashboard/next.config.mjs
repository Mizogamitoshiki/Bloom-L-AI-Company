import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // src/core・src/adapters をワークスペース外ディレクトリとしてimportする
  experimental: { externalDir: true },
  // better-sqlite3 はネイティブモジュールのためバンドルしない
  serverExternalPackages: ["better-sqlite3"],
  // ホーム配下の無関係なlockfileをワークスペースルートと誤認しないよう明示(リポジトリルート)
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
