import { describe, it, expect } from "vitest";
import { deriveEmployeeDisplay, assertPostTransition, assertTaskTransition, InvalidTransitionError } from "@core/reducers";
import type { TaskRow, TaskEventRow } from "@core/domain";

const NOW = new Date("2026-07-13T10:00:00.000Z");
const TODAY = "2026-07-13";

function task(partial: Partial<TaskRow>): TaskRow {
  return {
    id: "task1",
    idempotencyKey: "k",
    type: "research",
    title: "調査",
    assigneeId: "emp_rin",
    postId: null,
    status: "running",
    priority: 5,
    inputJson: null,
    retryCount: 0,
    runDate: TODAY,
    error: null,
    createdAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    finishedAt: null,
    ...partial,
  };
}

function ev(taskId: string, seq: number, type: TaskEventRow["type"], minutesAgo: number, stage?: string): TaskEventRow {
  return {
    id: `ev${seq}`,
    taskId,
    seq,
    ts: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    type,
    payloadJson: stage ? JSON.stringify({ stage }) : null,
    actor: "test",
  };
}

function derive(tasks: TaskRow[], events: TaskEventRow[], awaiting = 0) {
  const byTask = new Map<string, TaskEventRow[]>();
  for (const e of events) {
    const arr = byTask.get(e.taskId) ?? [];
    arr.push(e);
    byTask.set(e.taskId, arr);
  }
  return deriveEmployeeDisplay({
    tasks,
    eventsByTask: byTask,
    awaitingApprovalCount: awaiting,
    today: TODAY,
    now: NOW,
    staleMinutes: 10,
  });
}

describe("deriveEmployeeDisplay(信頼性絶対条件 AC-9/10)", () => {
  it("タスクが1件もなければ待機(idle)になる", () => {
    expect(derive([], []).state).toBe("idle");
  });

  it("queuedのみでは『作業中』系にならない(実行イベントなし)", () => {
    const d = derive([task({ status: "queued" })], [ev("task1", 1, "created", 5), ev("task1", 2, "queued", 5)]);
    expect(["idle"]).toContain(d.state);
  });

  it("DB上runningでもstartedイベントが無ければ状態不明(stale)を表示し『作業中』にしない", () => {
    const d = derive([task({ status: "running" })], [ev("task1", 1, "created", 5)]);
    expect(d.state).toBe("stale");
  });

  it("running+新鮮なheartbeatでタスク種別に応じた作業中表示になる", () => {
    const d = derive(
      [task({ status: "running", type: "research" })],
      [ev("task1", 1, "started", 8), ev("task1", 2, "heartbeat", 2, "競合調査")],
    );
    expect(d.state).toBe("researching");
    expect(d.stage).toBe("競合調査");
  });

  it("heartbeatが10分を超えて途絶えたら状態不明(stale)に落ちる(AC-10)", () => {
    const d = derive(
      [task({ status: "running" })],
      [ev("task1", 1, "started", 30), ev("task1", 2, "heartbeat", 15)],
    );
    expect(d.state).toBe("stale");
    expect(d.reason).toContain("分経過");
  });

  it("qaタスク実行中は品質確認中になる", () => {
    const d = derive([task({ status: "running", type: "qa" })], [ev("task1", 1, "started", 1)]);
    expect(d.state).toBe("qa");
  });

  it("budget_pausedのタスクがあれば予算停止表示", () => {
    expect(derive([task({ status: "budget_paused" })], []).state).toBe("budget_paused");
  });

  it("本日failedがあればエラー表示(理由を含む)", () => {
    const d = derive([task({ status: "failed", error: "検証に失敗" })], []);
    expect(d.state).toBe("error");
    expect(d.reason).toContain("検証に失敗");
  });

  it("承認待ち成果物があれば承認待ち表示(実行タスクなしの場合)", () => {
    const d = derive([task({ status: "done" })], [], 2);
    expect(d.state).toBe("awaiting_approval");
    expect(d.awaitingApprovalCount).toBe(2);
  });

  it("本日done(承認待ちなし)は本日完了", () => {
    expect(derive([task({ status: "done" })], []).state).toBe("done_today");
  });

  it("過去日のdoneは本日完了にならない(idle)", () => {
    expect(derive([task({ status: "done", runDate: "2026-07-10" })], []).state).toBe("idle");
  });
});

describe("状態遷移ガード(AC-15相当の基盤)", () => {
  it("QA未通過(drafting)から直接awaiting_approvalへは遷移できない", () => {
    expect(() => assertPostTransition("drafting", "awaiting_approval")).toThrow(InvalidTransitionError);
  });
  it("qa_review→awaiting_approvalは許可される", () => {
    expect(() => assertPostTransition("qa_review", "awaiting_approval")).not.toThrow();
  });
  it("承認なしにexported/publishedへ進めない", () => {
    expect(() => assertPostTransition("awaiting_approval", "exported")).toThrow(InvalidTransitionError);
    expect(() => assertPostTransition("qa_review", "published")).toThrow(InvalidTransitionError);
  });
  it("タスクのdone→runningのような逆行は拒否される", () => {
    expect(() => assertTaskTransition("done", "running")).toThrow(InvalidTransitionError);
  });
});
