/** Playwright global-teardown: E2E一時領域を削除する。 */
import { rmSync } from "node:fs";
import path from "node:path";

async function globalTeardown(): Promise<void> {
  const db = process.env.BLOOM_DB_PATH;
  if (db) rmSync(path.dirname(db), { recursive: true, force: true });
}

export default globalTeardown;
