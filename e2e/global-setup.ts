/**
 * Playwright global-setup: 一時DB/workspace/backupsを作り直し、E2Eデータをシードする。
 * 環境変数(BLOOM_DB_PATH等)は playwright.config.ts で設定済み。
 */
import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";

async function globalSetup(): Promise<void> {
  const db = process.env.BLOOM_DB_PATH!;
  const ws = process.env.BLOOM_WORKSPACE_PATH!;
  const bk = process.env.BLOOM_BACKUP_PATH!;
  const root = path.dirname(db);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  mkdirSync(bk, { recursive: true });
  const { seedE2E } = await import("./seed");
  await seedE2E();
}

export default globalSetup;
