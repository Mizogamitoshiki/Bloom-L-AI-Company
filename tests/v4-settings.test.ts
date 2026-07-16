import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import { ensureSeedOrg, getOperationSettings, updateOperationSettings } from "@adapters/db/store";

let dir: string; let opened: OpenedDb;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "bloom-v4s-")); opened = openDb(path.join(dir, "s.db")); ensureSeedOrg(opened.db); });
afterEach(() => { opened.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

describe("V4-D: 運用設定", () => {
  it("既定値を返し、owner更新でsetting_changed監査が残る", () => {
    expect(getOperationSettings(opened.db).weeklyPostTarget).toBe(3);
    updateOperationSettings(opened.db, { weeklyPostTarget: 5, ownerDailyMinutes: 45, timezone: "Asia/Tokyo" }, "owner");
    expect(getOperationSettings(opened.db).weeklyPostTarget).toBe(5);
    const a = opened.db.select().from(t.auditLog).where(and(eq(t.auditLog.action, "setting_changed"), eq(t.auditLog.subjectId, "operation_settings"))).all();
    expect(a).toHaveLength(1);
  });
  it("owner以外は拒否、範囲外はZodで拒否", () => {
    expect(() => updateOperationSettings(opened.db, { weeklyPostTarget: 3, ownerDailyMinutes: 30, timezone: "Asia/Tokyo" }, "aoi")).toThrow(/代表者/);
    expect(() => updateOperationSettings(opened.db, { weeklyPostTarget: 9, ownerDailyMinutes: 30, timezone: "Asia/Tokyo" }, "owner")).toThrow();
    expect(() => updateOperationSettings(opened.db, { weeklyPostTarget: 3, ownerDailyMinutes: 5, timezone: "Asia/Tokyo" }, "owner")).toThrow();
  });
});
