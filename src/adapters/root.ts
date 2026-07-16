/**
 * リポジトリルート解決。Next.js(cwd=apps/dashboard)とCLI(cwd=ルート)の双方から
 * data/ と config/ を正しく参照するため、pnpm-workspace.yaml を目印に上方探索する。
 */
import { existsSync } from "node:fs";
import path from "node:path";

let cached: string | null = null;

export function findRepoRoot(start: string = process.cwd()): string {
  if (cached) return cached;
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      cached = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cached = path.resolve(start);
  return cached;
}

/**
 * ワークスペースルート(素材・生成物・書き出しの基点)。
 * 既定は <repo>/data/workspace。BLOOM_WORKSPACE_PATH で上書き可能(テスト/E2Eは一時ディレクトリを指定し実データを汚さない)。
 */
export function workspaceRoot(): string {
  return process.env.BLOOM_WORKSPACE_PATH ?? path.join(findRepoRoot(), "data", "workspace");
}
