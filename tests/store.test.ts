import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import {
  ensureSeedOrg,
  createTask,
  startTask,
  heartbeat,
  submitArtifact,
  failTask,
  runStart,
  runFinish,
  getCompanyState,
  cancelTask,
} from "@adapters/db/store";
import { seedDemo } from "@adapters/db/demo";

let dir: string;
let opened: OpenedDb;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-test-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const SPEC = {
  type: "research" as const,
  title: "泉州地域の調査",
  assigneeId: "emp_rin",
  priority: 5,
};

describe("createTask 冪等性(AC-3)", () => {
  it("同一スペック・同一日で2回作成しても1件しかできない", () => {
    const r1 = createTask(opened.db, SPEC, "2026-07-13");
    const r2 = createTask(opened.db, SPEC, "2026-07-13");
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.task.id).toBe(r1.task.id);
  });

  it("不正なスペックはZodが拒否しDBに書かれない", () => {
    expect(() => createTask(opened.db, { ...SPEC, type: "invalid" as never }, "2026-07-13")).toThrow();
  });
});

describe("タスクライフサイクルとイベント", () => {
  it("start→heartbeat→submitで成果物が保存されタスクがdoneになる", () => {
    const { task } = createTask(opened.db, SPEC, "2026-07-13");
    startTask(opened.db, task.id, "rin");
    heartbeat(opened.db, task.id, "情報源の確認", "rin");
    const r = submitArtifact(
      opened.db,
      task.id,
      { kind: "note", title: "調査メモ", body: "テスト本文" },
      "rin",
    );
    expect(r.artifactId).toBeTruthy();
    const state = getCompanyState(opened.db);
    const rin = state.employees.find((e) => e.id === "emp_rin")!;
    expect(["done_today"]).toContain(rin.display.state);
  });

  it("スキーマ不一致の成果物は拒否され、タスクはdoneにならない", () => {
    const { task } = createTask(opened.db, SPEC, "2026-07-13");
    startTask(opened.db, task.id, "rin");
    expect(() => submitArtifact(opened.db, task.id, { kind: "note", title: "" }, "rin")).toThrow();
  });

  it("failTaskはリトライ上限(2回)まではqueuedに戻し、超過でfailedにする(無制限再試行の禁止)", () => {
    const { task } = createTask(opened.db, SPEC, "2026-07-13");
    startTask(opened.db, task.id, "rin");
    expect(failTask(opened.db, task.id, "1回目", "rin").retried).toBe(true);
    startTask(opened.db, task.id, "rin");
    expect(failTask(opened.db, task.id, "2回目", "rin").retried).toBe(true);
    startTask(opened.db, task.id, "rin");
    expect(failTask(opened.db, task.id, "3回目", "rin").retried).toBe(false);
  });

  it("done後のcancelは不正遷移として拒否される", () => {
    const { task } = createTask(opened.db, SPEC, "2026-07-13");
    startTask(opened.db, task.id, "rin");
    submitArtifact(opened.db, task.id, { kind: "note", title: "t", body: "b" }, "rin");
    expect(() => cancelTask(opened.db, task.id, "owner")).toThrow();
  });
});

describe("run-start 異常終了回収(AC-2)", () => {
  it("終了イベントのないrunの残タスクをfailedにして回収する", () => {
    const r1 = runStart(opened.db, "2026-07-12");
    const { task } = createTask(opened.db, SPEC, "2026-07-12");
    startTask(opened.db, task.id, "rin");
    // run-finishせずに翌日のrun-start(=前日異常終了)
    const r2 = runStart(opened.db, "2026-07-13");
    expect(r2.abnormalPrevRun).toBe(true);
    expect(r2.recoveredTaskIds).toContain(task.id);
    expect(r1.runId).not.toBe(r2.runId);
  });

  it("同日2回目のrun-startは既存runを再開する(冪等)", () => {
    const r1 = runStart(opened.db, "2026-07-13");
    const r2 = runStart(opened.db, "2026-07-13");
    expect(r2.resumedExisting).toBe(true);
    expect(r2.runId).toBe(r1.runId);
  });

  it("正常終了したrunは回収対象にならない", () => {
    const r1 = runStart(opened.db, "2026-07-12");
    runFinish(opened.db, r1.runId);
    const r2 = runStart(opened.db, "2026-07-13");
    expect(r2.abnormalPrevRun).toBe(false);
  });
});

describe("デモデータ(docs/16)", () => {
  it("seedDemoでdemo_mode=trueになり、9名分の状態が導出される", () => {
    seedDemo(opened.db);
    const state = getCompanyState(opened.db);
    expect(state.demoMode).toBe(true);
    expect(state.employees).toHaveLength(9);
    const states = new Map(state.employees.map((e) => [e.id, e.display.state]));
    expect(states.get("emp_rin")).toBe("researching");
    expect(states.get("emp_sora")).toBe("stale"); // heartbeat途絶(AC-10)
    expect(states.get("emp_tsumugi")).toBe("error");
    expect(states.get("emp_minato")).toBe("budget_paused");
    expect(states.get("emp_kotoha")).toBe("awaiting_approval");
    expect(states.get("emp_hinata")).toBe("idle"); // DM支援は第2段階のため待機
  });
});
