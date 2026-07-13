/**
 * V1レビュー指摘(2026-07-13)の修正を検証するテスト。
 * 1) 冪等キー(stepKey/postId) 2) トランザクションのロールバック
 * 3) 参照整合性 4) 再開時の状態リセット
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  ensureSeedOrg,
  createTask,
  startTask,
  submitArtifact,
  failTask,
  resumeTask,
  buildIdempotencyKey,
  getCompanyState,
} from "@adapters/db/store";
import { ulid, nowIso } from "@core/ids";

let dir: string;
let opened: OpenedDb;
const DATE = "2026-07-13";

function makePost(id: string): void {
  opened.db
    .insert(t.posts)
    .values({ id, pillar: "6", format: "carousel", title: `投稿${id}`, status: "idea", publishMethod: "manual", rightsState: "n/a" })
    .run();
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-fix-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("1. 冪等キー(stepKey / postId)", () => {
  it("同一postId・同一ステップの再登録は同一タスクになる", () => {
    makePost("postA");
    const spec = { type: "write_copy" as const, title: "本文作成", assigneeId: "emp_kotoha", postId: "postA", stepKey: "copy", priority: 5 };
    const r1 = createTask(opened.db, spec, DATE);
    const r2 = createTask(opened.db, spec, DATE);
    expect(r2.created).toBe(false);
    expect(r2.task.id).toBe(r1.task.id);
  });

  it("異なるpostIdの同名タスクは別タスクになる", () => {
    makePost("postA");
    makePost("postB");
    const base = { type: "write_copy" as const, title: "本文作成", assigneeId: "emp_kotoha", stepKey: "copy", priority: 5 };
    const rA = createTask(opened.db, { ...base, postId: "postA" }, DATE);
    const rB = createTask(opened.db, { ...base, postId: "postB" }, DATE);
    expect(rA.created).toBe(true);
    expect(rB.created).toBe(true);
    expect(rA.task.id).not.toBe(rB.task.id);
  });

  it("同じkickoffプラン(複数タスク)の再実行で二重生成されない", () => {
    makePost("postA");
    const plan = [
      { type: "research" as const, title: "地域調査", assigneeId: "emp_rin", stepKey: "research", priority: 5 },
      { type: "write_copy" as const, title: "本文作成", assigneeId: "emp_kotoha", postId: "postA", stepKey: "copy", priority: 5 },
      { type: "qa" as const, title: "品質チェック", assigneeId: "emp_shion", postId: "postA", stepKey: "qa", priority: 5 },
    ];
    const first = plan.map((s) => createTask(opened.db, s, DATE));
    const second = plan.map((s) => createTask(opened.db, s, DATE));
    expect(first.every((r) => r.created)).toBe(true);
    expect(second.every((r) => !r.created)).toBe(true);
    const count = opened.sqlite.prepare("select count(*) n from tasks").get() as { n: number };
    expect(count.n).toBe(3);
  });

  it("タイトル先頭40文字が同じでも別stepKeyなら衝突しない", () => {
    const longTitle = "泉州地域向けカルーセル投稿の作成タスク(これはタイトル先頭40文字がまったく同一になる長い名前)- A案";
    const longTitle2 = "泉州地域向けカルーセル投稿の作成タスク(これはタイトル先頭40文字がまったく同一になる長い名前)- B案";
    expect(longTitle.slice(0, 40)).toBe(longTitle2.slice(0, 40));
    const r1 = createTask(opened.db, { type: "design", title: longTitle, assigneeId: "emp_tsumugi", stepKey: "design-a", priority: 5 }, DATE);
    const r2 = createTask(opened.db, { type: "design", title: longTitle2, assigneeId: "emp_tsumugi", stepKey: "design-b", priority: 5 }, DATE);
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(r1.task.id).not.toBe(r2.task.id);
  });

  it("buildIdempotencyKeyは runDate/type/assignee/postId/stepKey をすべて含む", () => {
    const key = buildIdempotencyKey(
      { type: "qa", title: "x", assigneeId: "emp_shion", postId: "p1", stepKey: "qa", priority: 5 },
      DATE,
    );
    expect(key).toBe("2026-07-13:qa:emp_shion:p1:qa");
  });
});

describe("2. トランザクションのロールバック", () => {
  it("submitArtifact途中(利用量記録)で失敗すると成果物・イベント・タスク完了がすべて巻き戻る", () => {
    const { task } = createTask(opened.db, { type: "research", title: "調査", assigneeId: "emp_rin", stepKey: "r1", priority: 5 }, DATE);
    startTask(opened.db, task.id, "rin");
    // 最終ステップ(usage_records挿入)を強制的に失敗させる
    opened.sqlite.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON usage_records BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    );
    expect(() =>
      submitArtifact(opened.db, task.id, { kind: "note", title: "メモ", body: "本文" }, "rin"),
    ).toThrow(/boom/);
    opened.sqlite.exec("DROP TRIGGER boom;");

    const after = opened.db.select().from(t.tasks).where(eq(t.tasks.id, task.id)).get()!;
    expect(after.status).toBe("running"); // done へ進んでいない
    const artifacts = opened.db.select().from(t.artifacts).where(eq(t.artifacts.taskId, task.id)).all();
    expect(artifacts).toHaveLength(0); // 成果物も巻き戻り
    const events = opened.db.select().from(t.taskEvents).where(eq(t.taskEvents.taskId, task.id)).all();
    expect(events.map((e) => e.type)).not.toContain("artifact_added");
    expect(events.map((e) => e.type)).not.toContain("succeeded");
  });

  it("startTask途中(イベント記録)で失敗するとタスクはqueuedのまま", () => {
    const { task } = createTask(opened.db, { type: "research", title: "調査2", assigneeId: "emp_rin", stepKey: "r2", priority: 5 }, DATE);
    opened.sqlite.exec(
      "CREATE TRIGGER boom2 BEFORE INSERT ON task_events WHEN NEW.type = 'started' BEGIN SELECT RAISE(ABORT, 'boom2'); END;",
    );
    expect(() => startTask(opened.db, task.id, "rin")).toThrow(/boom2/);
    opened.sqlite.exec("DROP TRIGGER boom2;");
    const after = opened.db.select().from(t.tasks).where(eq(t.tasks.id, task.id)).get()!;
    expect(after.status).toBe("queued");
    expect(after.startedAt).toBeNull();
  });
});

describe("3. 参照整合性", () => {
  it("存在しない社員IDではタスクを作成できない(ユースケース層の存在確認)", () => {
    expect(() =>
      createTask(opened.db, { type: "research", title: "調査", assigneeId: "emp_ghost", stepKey: "r", priority: 5 }, DATE),
    ).toThrow(/社員が存在しません/);
    const count = opened.sqlite.prepare("select count(*) n from tasks").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("存在しないpostIdではタスクを作成できない", () => {
    expect(() =>
      createTask(
        opened.db,
        { type: "qa", title: "QA", assigneeId: "emp_shion", postId: "no-such-post", stepKey: "qa", priority: 5 },
        DATE,
      ),
    ).toThrow(/投稿が存在しません/);
  });

  it("外部キー制約: 存在しないtask_idのイベントはDBレベルで拒否される", () => {
    expect(() =>
      opened.sqlite
        .prepare("insert into task_events (id, task_id, seq, ts, type, actor) values (?, ?, 1, ?, 'created', 'x')")
        .run(ulid(), "no-such-task", nowIso()),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("外部キー制約: 存在しない社員のタスク直接INSERTはDBレベルで拒否される", () => {
    expect(() =>
      opened.sqlite
        .prepare(
          "insert into tasks (id, idempotency_key, type, title, assignee_id, status, run_date, created_at) values (?, ?, 'research', 'x', 'emp_ghost', 'queued', ?, ?)",
        )
        .run(ulid(), `raw:${ulid()}`, DATE, nowIso()),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe("4. 再開時の状態リセット", () => {
  function failToLimit(taskId: string): void {
    startTask(opened.db, taskId, "rin");
    failTask(opened.db, taskId, "1回目", "rin");
    startTask(opened.db, taskId, "rin");
    failTask(opened.db, taskId, "2回目", "rin");
    startTask(opened.db, taskId, "rin");
    failTask(opened.db, taskId, "3回目の失敗理由", "rin");
  }

  it("resumeでerror/startedAt/finishedAt/retryCountがリセットされ、失敗が現在のエラーとして表示されない", () => {
    const { task } = createTask(opened.db, { type: "research", title: "調査", assigneeId: "emp_rin", stepKey: "r1", priority: 5 }, DATE);
    failToLimit(task.id);
    const failed = opened.db.select().from(t.tasks).where(eq(t.tasks.id, task.id)).get()!;
    expect(failed.status).toBe("failed");
    expect(getCompanyState(opened.db).employees.find((e) => e.id === "emp_rin")!.display.state).toBe("error");

    resumeTask(opened.db, task.id, "owner");
    const resumed = opened.db.select().from(t.tasks).where(eq(t.tasks.id, task.id)).get()!;
    expect(resumed.status).toBe("queued");
    expect(resumed.error).toBeNull();
    expect(resumed.startedAt).toBeNull();
    expect(resumed.finishedAt).toBeNull();
    expect(resumed.retryCount).toBe(0);

    // UI表示: エラーではなく待機になる(古い失敗を現在のエラーとして出さない)
    const rin = getCompanyState(opened.db).employees.find((e) => e.id === "emp_rin")!;
    expect(rin.display.state).toBe("idle");
    expect(rin.display.reason).not.toContain("失敗");

    // 履歴はイベントログに残る(直前の失敗理由付きqueuedイベント)
    const events = opened.db.select().from(t.taskEvents).where(eq(t.taskEvents.taskId, task.id)).all();
    const lastQueued = events.filter((e) => e.type === "queued").at(-1)!;
    expect(lastQueued.payloadJson).toContain("3回目の失敗理由");
  });

  it("resume後に再startでき、リトライ枠も回復している", () => {
    const { task } = createTask(opened.db, { type: "research", title: "調査B", assigneeId: "emp_rin", stepKey: "r2", priority: 5 }, DATE);
    failToLimit(task.id);
    resumeTask(opened.db, task.id, "owner");
    startTask(opened.db, task.id, "rin"); // queued→running が通る
    expect(failTask(opened.db, task.id, "再失敗", "rin").retried).toBe(true); // retryCount=0から再カウント
  });
});
