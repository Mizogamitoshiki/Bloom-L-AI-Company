import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

/**
 * E2E(V4-F)。実データを触らないよう、一時DB/workspace/backups + 専用ポートで隔離して動かす。
 * 実行: pnpm e2e(ブラウザ未取得なら先に pnpm e2e:install)。
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const E2E_ROOT = path.resolve(".e2e-tmp");

// 一時領域(global-setup / webServer の双方が参照)。実 data/ とは無関係。
process.env.BLOOM_DB_PATH = path.join(E2E_ROOT, "company.db");
process.env.BLOOM_WORKSPACE_PATH = path.join(E2E_ROOT, "workspace");
process.env.BLOOM_BACKUP_PATH = path.join(E2E_ROOT, "backups");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --filter dashboard exec next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BLOOM_DB_PATH: process.env.BLOOM_DB_PATH,
      BLOOM_WORKSPACE_PATH: process.env.BLOOM_WORKSPACE_PATH,
      BLOOM_BACKUP_PATH: process.env.BLOOM_BACKUP_PATH,
    },
  },
});
