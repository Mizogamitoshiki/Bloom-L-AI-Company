/**
 * plan-commit用スキーマ(stepKey必須)の構造的強制を検証(V1再レビュー指摘・2026-07-13)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import { ensureSeedOrg, createTask } from "@adapters/db/store";
import { planCommitSchema, plannedTaskSpecSchema, taskSpecSchema } from "@core/schemas";

let dir: string;
let opened: OpenedDb;
const DATE = "2026-07-13";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-plan-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("plan-commit用スキーマはstepKeyを必須にする", () => {
  it("1. stepKeyなしのplan-commitタスクはZod検証エラーになる", () => {
    const plan = {
      runDate: DATE,
      tasks: [{ type: "research", title: "地域調査", assigneeId: "emp_rin", priority: 5 }],
    };
    const result = planCommitSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".").includes("stepKey"))).toBe(true);
    }
    // 単体スキーマでも同様
    expect(
      plannedTaskSpecSchema.safeParse({ type: "research", title: "x", assigneeId: "emp_rin", priority: 5 }).success,
    ).toBe(false);
    // stepKey付きなら通過する
    expect(
      planCommitSchema.safeParse({
        runDate: DATE,
        tasks: [{ type: "research", title: "地域調査", assigneeId: "emp_rin", stepKey: "research", priority: 5 }],
      }).success,
    ).toBe(true);
  });

  it("2. 手動create-task(taskSpecSchema)ではstepKey省略時のフォールバックが使える", () => {
    const spec = taskSpecSchema.parse({ type: "research", title: "手動の調査タスク", assigneeId: "emp_rin", priority: 5 });
    const r1 = createTask(opened.db, spec, DATE);
    const r2 = createTask(opened.db, spec, DATE);
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false); // titleフォールバックで冪等
    expect(r1.task.idempotencyKey).toContain("手動の調査タスク");
  });

  it("3. stepKey付きの同一プランをplan-commit相当で2回実行しても重複しない", () => {
    const plan = planCommitSchema.parse({
      runDate: DATE,
      tasks: [
        { type: "research", title: "地域調査", assigneeId: "emp_rin", stepKey: "research", priority: 5 },
        { type: "plan_posts", title: "投稿企画", assigneeId: "emp_sora", stepKey: "plan", priority: 5 },
      ],
    });
    const first = plan.tasks.map((s) => createTask(opened.db, s, plan.runDate));
    const second = plan.tasks.map((s) => createTask(opened.db, s, plan.runDate));
    expect(first.every((r) => r.created)).toBe(true);
    expect(second.every((r) => !r.created)).toBe(true);
    expect(second.map((r) => r.task.id)).toEqual(first.map((r) => r.task.id));
    const count = opened.sqlite.prepare("select count(*) n from tasks").get() as { n: number };
    expect(count.n).toBe(2);
  });
});
