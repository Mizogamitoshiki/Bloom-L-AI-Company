/**
 * 改善#9: company statusの利用上限・残数表示。
 * 表示用の集計は実際の制限判定(startTask等)と同一クエリ・同一JST業務日基準を使うため、
 * 「あと何回起動できるか」が実際に一致することを確認する。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import { ensureSeedOrg, createTask, startTask, getCompanyState, usageLimitStatus } from "@adapters/db/store";
import { businessDate } from "@core/ids";

let dir: string;
let opened: OpenedDb;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-usage-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});
afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("usageLimitStatus", () => {
  it("未使用時は各項目のused=0・remaining=limitと一致する", () => {
    const rows = usageLimitStatus(opened.db);
    const tasks = rows.find((r) => r.key === "max_tasks")!;
    expect(tasks.used).toBe(0);
    expect(tasks.remaining).toBe(tasks.limit);
  });

  it("エージェント起動を実行した回数だけused/remainingが実際の制限判定と一致して変化する", () => {
    const { task } = createTask(opened.db, { type: "research", title: "調査", assigneeId: "emp_rin", priority: 5 }, businessDate());
    startTask(opened.db, task.id, "rin");
    const rows = usageLimitStatus(opened.db);
    const launches = rows.find((r) => r.key === "max_agent_launches")!;
    expect(launches.used).toBe(1);
    expect(launches.remaining).toBe(launches.limit - 1);
    const tasks = rows.find((r) => r.key === "max_tasks")!;
    expect(tasks.used).toBe(1);
  });

  it("company statusのgetCompanyStateにusageLimitsとして含まれる", () => {
    const state = getCompanyState(opened.db);
    expect(state.usageLimits.length).toBe(7); // V10: max_site_samples を追加
    expect(state.usageLimits.map((r) => r.key)).toContain("max_agent_launches");
  });

  it("remainingは負にならない(上限超過状態でも0で頭打ち)", () => {
    // 上限に達するまでタスクを作り、起動上限ぴったりまで進める(既存テストのmax+1パターンと同型)
    const limit = usageLimitStatus(opened.db).find((r) => r.key === "max_agent_launches")!.limit;
    for (let i = 0; i < limit; i++) {
      const { task } = createTask(opened.db, { type: "research", title: `調査${i}`, assigneeId: "emp_rin", priority: 5, stepKey: `s${i}` }, businessDate());
      startTask(opened.db, task.id, "rin");
    }
    const rows = usageLimitStatus(opened.db);
    const launches = rows.find((r) => r.key === "max_agent_launches")!;
    expect(launches.used).toBe(limit);
    expect(launches.remaining).toBe(0);
  });
});
