/**
 * V7: AI社員管理ビュー(employeesAdminView)。
 * 全社員がペルソナ・部署・実績集計つきで返り、タスク実績が正しく集計される。
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import { createPost, createTask, ensureSeedOrg, startTask, submitArtifact } from "@adapters/db/store";
import { employeesAdminView } from "@adapters/db/views";
import { EMPLOYEES } from "@core/org";
import { PLAN } from "./fixtures";

let dir: string, opened: OpenedDb;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-empadmin-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});
afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("V7 AI社員管理ビュー", () => {
  it("全社員がペルソナ・部署つきで返る", () => {
    const view = employeesAdminView(opened.db);
    expect(view.employees.length).toBe(EMPLOYEES.length);
    for (const emp of view.employees) {
      expect(emp.persona, `${emp.name}(${emp.agentRef})のペルソナ`).not.toBeNull();
      expect(emp.persona!.purpose.length).toBeGreaterThan(0);
      expect(emp.persona!.prohibitions.length).toBeGreaterThan(0);
      expect(view.departments.some((d) => d.id === emp.departmentId)).toBe(true);
    }
    // 2026-07-27: 実働ゼロの陽葵は削除済み(全員activeInMvp=true)
    expect(view.employees.find((e) => e.agentRef === "hinata")).toBeUndefined();
  });

  it("タスク実績(完了数・成果物数・最終稼働)が集計される", () => {
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "実績集計テスト" }, "aoi");
    const task = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, "2026-07-19").task;
    startTask(opened.db, task.id, "sora");
    submitArtifact(opened.db, task.id, PLAN, "sora");

    const sora = employeesAdminView(opened.db).employees.find((e) => e.agentRef === "sora")!;
    expect(sora.stats.tasksDone).toBe(1);
    expect(sora.stats.tasksFailed).toBe(0);
    expect(sora.stats.artifacts).toBeGreaterThanOrEqual(1);
    expect(sora.stats.lastActivityAt).not.toBeNull();
    expect(sora.recentTasks[0]!.title).toBe("企画");
    expect(sora.recentTasks[0]!.status).toBe("done");
  });
});
