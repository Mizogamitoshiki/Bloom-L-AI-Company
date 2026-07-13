/**
 * ユースケース層 = DBへの唯一の書き込み経路(docs/07, IMPLEMENTATION_HANDOFF 不変条件1)。
 * CLI(エージェント側)とUI APIの双方がここを通る。
 * - 全書き込みはZod検証済みの値のみ
 * - task_events / audit_log はappend-only(UPDATE/DELETE関数を提供しない)
 * - リトライ上限・冪等性・状態遷移ガード・参照存在確認をここで強制
 * - 複数書き込みを伴う操作は1トランザクション(途中失敗で全ロールバック)
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RunResult } from "better-sqlite3";
import type { Db } from "./client";
import * as t from "./schema";
import * as schema from "./schema";
import { ulid, nowIso, todayLocal } from "../../core/ids";
import {
  eventPayloadSchema,
  taskSpecSchema,
  artifactContentSchema,
  SCHEMA_VERSION,
  type EventPayload,
  type TaskSpec,
} from "../../core/schemas";
import {
  type TaskEventType,
  type TaskStatus,
  type TaskRow,
  type TaskEventRow,
  type TaskType,
} from "../../core/domain";
import { assertTaskTransition, deriveEmployeeDisplay, type EmployeeDisplay } from "../../core/reducers";
import { DEPARTMENTS, EMPLOYEES } from "../../core/org";
import { loadLimits } from "../config";

/** DB本体とトランザクションの両方を受けられる接続型 */
export type DbConn = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

// ---------- 共通(append-only書き込み) ----------

export function audit(
  conn: DbConn,
  actor: string,
  action: string,
  subjectType: string,
  subjectId: string,
  detail?: Record<string, unknown>,
): void {
  conn
    .insert(t.auditLog)
    .values({
      id: ulid(),
      ts: nowIso(),
      actor,
      action,
      subjectType,
      subjectId,
      detailJson: detail ? JSON.stringify(detail) : null,
    })
    .run();
}

export function appendEvent(
  conn: DbConn,
  taskId: string,
  type: TaskEventType,
  actor: string,
  payload?: EventPayload,
): void {
  const validated = payload ? eventPayloadSchema.parse(payload) : undefined;
  const last = conn
    .select({ seq: t.taskEvents.seq })
    .from(t.taskEvents)
    .where(eq(t.taskEvents.taskId, taskId))
    .orderBy(desc(t.taskEvents.seq))
    .limit(1)
    .all();
  const seq = (last[0]?.seq ?? 0) + 1;
  conn
    .insert(t.taskEvents)
    .values({
      id: ulid(),
      taskId,
      seq,
      ts: nowIso(),
      type,
      payloadJson: validated ? JSON.stringify(validated) : null,
      actor,
    })
    .run();
}

export function getSetting<T>(conn: DbConn, key: string): T | null {
  const row = conn.select().from(t.settings).where(eq(t.settings.key, key)).get();
  return row ? (JSON.parse(row.valueJson) as T) : null;
}

export function setSetting(conn: DbConn, key: string, value: unknown): void {
  conn
    .insert(t.settings)
    .values({ key, valueJson: JSON.stringify(value) })
    .onConflictDoUpdate({ target: t.settings.key, set: { valueJson: JSON.stringify(value) } })
    .run();
}

// ---------- 初期化 ----------

export function ensureSeedOrg(db: Db): void {
  db.transaction((tx) => {
    for (const d of DEPARTMENTS) {
      tx.insert(t.departments)
        .values({ id: d.id, name: d.name, status: d.status, unlockNote: d.unlockNote })
        .onConflictDoNothing()
        .run();
    }
    for (const e of EMPLOYEES) {
      tx.insert(t.employees)
        .values({
          id: e.id,
          departmentId: e.departmentId,
          name: e.name,
          role: e.role,
          agentRef: e.agentRef,
          modelProfile: e.modelProfile,
          personaJson: JSON.stringify({ spriteHue: e.spriteHue, activeInMvp: e.activeInMvp }),
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

// ---------- 参照存在確認(ユースケース層の防御。FK制約の手前で分かりやすいエラーを返す) ----------

function assertEmployeeExists(conn: DbConn, employeeId: string): void {
  const emp = conn.select({ id: t.employees.id }).from(t.employees).where(eq(t.employees.id, employeeId)).get();
  if (!emp) throw new Error(`社員が存在しません: ${employeeId}`);
}

function assertPostExists(conn: DbConn, postId: string): void {
  const post = conn.select({ id: t.posts.id }).from(t.posts).where(eq(t.posts.id, postId)).get();
  if (!post) throw new Error(`投稿が存在しません: ${postId}`);
}

// ---------- タスク ----------

export interface CreateTaskResult {
  task: typeof t.tasks.$inferSelect;
  created: boolean;
}

/**
 * 冪等キー: runDate : type : assigneeId : postId(なければ"-") : stepKey(なければtitle先頭40文字)。
 * - 同一kickoffの再実行 → 同一キーで重複しない
 * - 異なるpostId・異なるstepKey → 別タスク
 */
export function buildIdempotencyKey(spec: TaskSpec, runDate: string): string {
  const step = spec.stepKey ?? spec.title.replace(/\s+/g, "-").slice(0, 40);
  return [runDate, spec.type, spec.assigneeId, spec.postId ?? "-", step].join(":");
}

export function createTask(db: Db, specInput: TaskSpec, runDate: string, actor = "system"): CreateTaskResult {
  const spec = taskSpecSchema.parse(specInput);
  const key = buildIdempotencyKey(spec, runDate);

  return db.transaction((tx): CreateTaskResult => {
    const existing = tx.select().from(t.tasks).where(eq(t.tasks.idempotencyKey, key)).get();
    if (existing) return { task: existing, created: false };

    assertEmployeeExists(tx, spec.assigneeId);
    if (spec.postId) assertPostExists(tx, spec.postId);

    const limits = loadLimits();
    const countToday = tx
      .select({ n: sql<number>`count(*)` })
      .from(t.tasks)
      .where(eq(t.tasks.runDate, runDate))
      .get();
    if ((countToday?.n ?? 0) >= limits.daily.max_tasks) {
      throw new Error(`日次タスク上限(${limits.daily.max_tasks})に達しています(docs/14)`);
    }

    const task: typeof t.tasks.$inferInsert = {
      id: ulid(),
      idempotencyKey: key,
      type: spec.type,
      title: spec.title,
      assigneeId: spec.assigneeId,
      postId: spec.postId ?? null,
      status: "queued",
      priority: spec.priority,
      inputJson: spec.input ? JSON.stringify(spec.input) : null,
      retryCount: 0,
      runDate,
      error: null,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
    };
    tx.insert(t.tasks).values(task).run();
    appendEvent(tx, task.id, "created", actor);
    appendEvent(tx, task.id, "queued", actor);
    return { task: tx.select().from(t.tasks).where(eq(t.tasks.id, task.id)).get()!, created: true };
  });
}

function getTaskOrThrow(conn: DbConn, taskId: string): typeof t.tasks.$inferSelect {
  const task = conn.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) throw new Error(`タスクが見つかりません: ${taskId}`);
  return task;
}

function setTaskStatus(
  conn: DbConn,
  task: typeof t.tasks.$inferSelect,
  to: TaskStatus,
  patch: Partial<typeof t.tasks.$inferInsert> = {},
): void {
  assertTaskTransition(task.status as TaskStatus, to);
  conn.update(t.tasks).set({ status: to, ...patch }).where(eq(t.tasks.id, task.id)).run();
}

export function startTask(db: Db, taskId: string, actor: string): void {
  db.transaction((tx) => {
    const task = getTaskOrThrow(tx, taskId);
    setTaskStatus(tx, task, "running", { startedAt: nowIso(), finishedAt: null });
    appendEvent(tx, taskId, "started", actor);
  });
}

export function heartbeat(db: Db, taskId: string, stage: string, actor: string): void {
  db.transaction((tx) => {
    const task = getTaskOrThrow(tx, taskId);
    if (task.status !== "running") {
      throw new Error(`runningでないタスクにheartbeatは記録できません(現在: ${task.status})`);
    }
    appendEvent(tx, taskId, "heartbeat", actor, { stage });
  });
}

export interface SubmitResult {
  artifactId: string;
}

/** 成果物提出 → 検証OKならタスク完了+利用量記録(全体で1トランザクション) */
export function submitArtifact(
  db: Db,
  taskId: string,
  content: unknown,
  actor: string,
  opts: { estInputChars?: number; estOutputChars?: number } = {},
): SubmitResult {
  const validated = artifactContentSchema.parse(content); // 検証はDB書き込みの前

  return db.transaction((tx): SubmitResult => {
    const task = getTaskOrThrow(tx, taskId);
    if (task.status !== "running") throw new Error(`runningでないタスクには提出できません(現在: ${task.status})`);

    const prevVersions = tx
      .select({ v: sql<number>`coalesce(max(version), 0)` })
      .from(t.artifacts)
      .where(and(eq(t.artifacts.taskId, taskId), eq(t.artifacts.kind, validated.kind)))
      .get();

    const artifactId = ulid();
    tx.insert(t.artifacts)
      .values({
        id: artifactId,
        taskId,
        postId: task.postId,
        kind: validated.kind,
        version: (prevVersions?.v ?? 0) + 1,
        contentJson: JSON.stringify(validated),
        filePath: null,
        schemaVersion: SCHEMA_VERSION,
        createdAt: nowIso(),
      })
      .run();
    appendEvent(tx, taskId, "artifact_added", actor, { artifactId });
    setTaskStatus(tx, task, "done", { finishedAt: nowIso(), error: null });
    appendEvent(tx, taskId, "succeeded", actor);

    const started = task.startedAt ? new Date(task.startedAt).getTime() : Date.now();
    tx.insert(t.usageRecords)
      .values({
        id: ulid(),
        taskId,
        modelProfile: getEmployeeProfile(tx, task.assigneeId),
        estInputChars: opts.estInputChars ?? 0,
        estOutputChars: opts.estOutputChars ?? JSON.stringify(validated).length,
        wallSeconds: Math.max(0, Math.round((Date.now() - started) / 1000)),
        ts: nowIso(),
      })
      .run();
    return { artifactId };
  });
}

function getEmployeeProfile(conn: DbConn, employeeId: string): string {
  const emp = conn.select().from(t.employees).where(eq(t.employees.id, employeeId)).get();
  return emp?.modelProfile ?? "standard";
}

/**
 * 失敗記録。リトライ上限内なら queued に戻す(retried)、超過で failed(無制限再試行の禁止)。
 * リトライ時: error には直近の失敗理由を保持(表示はstatus=failedの場合のみ「エラー」扱い)、
 * startedAt は次のstartで上書きされるためnullへ戻す。
 */
export function failTask(db: Db, taskId: string, error: string, actor: string): { retried: boolean } {
  const message = error.slice(0, 500);
  return db.transaction((tx): { retried: boolean } => {
    const task = getTaskOrThrow(tx, taskId);
    if (task.status !== "running") {
      if (task.status === "queued") {
        // 起動不能等: queuedからの失敗も記録できる
        tx.update(t.tasks)
          .set({ status: "failed", error: message, finishedAt: nowIso() })
          .where(eq(t.tasks.id, taskId))
          .run();
        appendEvent(tx, taskId, "failed", actor, { reason: message.slice(0, 200) });
        return { retried: false };
      }
      throw new Error(`失敗を記録できない状態です(現在: ${task.status})`);
    }
    const limits = loadLimits();
    if (task.retryCount < limits.retry.per_task) {
      tx.update(t.tasks)
        .set({ status: "queued", retryCount: task.retryCount + 1, error: message, startedAt: null })
        .where(eq(t.tasks.id, taskId))
        .run();
      appendEvent(tx, taskId, "retried", actor, { retryCount: task.retryCount + 1, reason: message.slice(0, 200) });
      return { retried: true };
    }
    setTaskStatus(tx, task, "failed", { error: message, finishedAt: nowIso() });
    appendEvent(tx, taskId, "failed", actor, { reason: message.slice(0, 200) });
    return { retried: false };
  });
}

export function cancelTask(db: Db, taskId: string, actor: string): void {
  db.transaction((tx) => {
    const task = getTaskOrThrow(tx, taskId);
    setTaskStatus(tx, task, "cancelled", { finishedAt: nowIso() });
    appendEvent(tx, taskId, "cancelled", actor);
    audit(tx, actor, "task_cancel", "task", taskId);
  });
}

export function pauseBudget(db: Db, taskId: string, reason: string, actor: string): void {
  db.transaction((tx) => {
    const task = getTaskOrThrow(tx, taskId);
    setTaskStatus(tx, task, "budget_paused");
    appendEvent(tx, taskId, "paused_budget", actor, { reason: reason.slice(0, 200) });
  });
}

/**
 * 再開(failed / budget_paused → queued)。
 * 過去の失敗を「現在のエラー」としてUIに残さないため、error / startedAt / finishedAt を消去し
 * retryCount を0へ戻す(人間の明示操作による再付与)。直前のエラーはイベントログに履歴として残る。
 */
export function resumeTask(db: Db, taskId: string, actor: string): void {
  db.transaction((tx) => {
    const task = getTaskOrThrow(tx, taskId);
    if (task.status !== "budget_paused" && task.status !== "failed") {
      throw new Error(`再開できるのは budget_paused / failed のみ(現在: ${task.status})`);
    }
    const priorError = task.error;
    setTaskStatus(tx, task, "queued", { error: null, startedAt: null, finishedAt: null, retryCount: 0 });
    appendEvent(tx, taskId, "queued", actor, {
      reason: priorError ? `再開(直前の失敗: ${priorError.slice(0, 150)})` : "代表者/社長補佐による再開",
    });
    audit(tx, actor, "task_resume", "task", taskId, priorError ? { priorError: priorError.slice(0, 200) } : undefined);
  });
}

// ---------- run(日次) ----------

export interface RunStartResult {
  runId: string;
  runDate: string;
  abnormalPrevRun: boolean;
  recoveredTaskIds: string[];
  resumedExisting: boolean;
}

export function runStart(db: Db, runDate: string = todayLocal(), actor = "system"): RunStartResult {
  return db.transaction((tx): RunStartResult => {
    // 同日runが実行中なら再開扱い(冪等)
    const existingToday = tx
      .select()
      .from(t.runs)
      .where(and(eq(t.runs.runDate, runDate), eq(t.runs.status, "running")))
      .get();
    if (existingToday) {
      return { runId: existingToday.id, runDate, abnormalPrevRun: false, recoveredTaskIds: [], resumedExisting: true };
    }

    // 前回異常終了(終了イベントなしのrun)の検出と回収(docs/06 例外フロー)
    const stuckRuns = tx.select().from(t.runs).where(eq(t.runs.status, "running")).all();
    const recovered: string[] = [];
    for (const run of stuckRuns) {
      const orphans = tx
        .select()
        .from(t.tasks)
        .where(and(eq(t.tasks.runDate, run.runDate), inArray(t.tasks.status, ["queued", "running"])))
        .all();
      for (const task of orphans) {
        tx.update(t.tasks)
          .set({ status: "failed", error: "前回run異常終了により回収", finishedAt: nowIso() })
          .where(eq(t.tasks.id, task.id))
          .run();
        appendEvent(tx, task.id, "failed", actor, { reason: "前回run異常終了により回収" });
        recovered.push(task.id);
      }
      tx.update(t.runs)
        .set({ status: "aborted", finishedAt: nowIso(), note: "異常終了を検出し回収" })
        .where(eq(t.runs.id, run.id))
        .run();
      audit(tx, actor, "run_abort_recovered", "run", run.id, { recovered: orphans.length });
    }

    const runId = ulid();
    tx.insert(t.runs).values({ id: runId, runDate, startedAt: nowIso(), status: "running", note: null }).run();
    audit(tx, actor, "run_start", "run", runId, { runDate, recovered: recovered.length });
    return { runId, runDate, abnormalPrevRun: stuckRuns.length > 0, recoveredTaskIds: recovered, resumedExisting: false };
  });
}

export function runFinish(db: Db, runId: string, actor = "system", note?: string): void {
  db.transaction((tx) => {
    const run = tx.select().from(t.runs).where(eq(t.runs.id, runId)).get();
    if (!run) throw new Error(`runが見つかりません: ${runId}`);
    if (run.status !== "running") throw new Error(`実行中でないrunは終了できません(現在: ${run.status})`);
    tx.update(t.runs).set({ status: "done", finishedAt: nowIso(), note: note ?? null }).where(eq(t.runs.id, runId)).run();
    audit(tx, actor, "run_finish", "run", runId);
  });
}

// ---------- 表示状態(読み取り) ----------

export interface EmployeeStateView {
  id: string;
  name: string;
  role: string;
  departmentId: string;
  modelProfile: string;
  activeInMvp: boolean;
  spriteHue: number;
  display: EmployeeDisplay;
  currentTaskTitle: string | null;
}

export interface CompanyStateView {
  demoMode: boolean;
  today: string;
  run: { id: string; status: string; startedAt: string; abnormalNote: string | null } | null;
  lastAbnormalRun: boolean;
  employees: EmployeeStateView[];
  departments: { id: string; name: string; status: string; unlockNote: string | null }[];
  counts: { awaitingApproval: number; errors: number; running: number };
}

export function getCompanyState(db: Db, now: Date = new Date()): CompanyStateView {
  const limits = loadLimits();
  const today = todayLocal(now);
  const employees = db.select().from(t.employees).orderBy(asc(t.employees.id)).all();
  const departments = db.select().from(t.departments).all();
  const allTasks = db.select().from(t.tasks).all() as unknown as TaskRow[];
  const taskIds = allTasks.map((x) => x.id);
  const allEvents =
    taskIds.length > 0
      ? (db.select().from(t.taskEvents).where(inArray(t.taskEvents.taskId, taskIds)).orderBy(asc(t.taskEvents.seq)).all() as unknown as TaskEventRow[])
      : [];
  const eventsByTask = new Map<string, TaskEventRow[]>();
  for (const ev of allEvents) {
    const arr = eventsByTask.get(ev.taskId) ?? [];
    arr.push(ev);
    eventsByTask.set(ev.taskId, arr);
  }

  // 承認待ち投稿 → 担当社員(その投稿の成果物を作ったタスクの担当者)
  const awaitingPosts = db.select().from(t.posts).where(eq(t.posts.status, "awaiting_approval")).all();
  const awaitingByEmployee = new Map<string, number>();
  for (const post of awaitingPosts) {
    const contributors = db
      .selectDistinct({ assigneeId: t.tasks.assigneeId })
      .from(t.artifacts)
      .innerJoin(t.tasks, eq(t.artifacts.taskId, t.tasks.id))
      .where(eq(t.artifacts.postId, post.id))
      .all();
    for (const c of contributors) {
      awaitingByEmployee.set(c.assigneeId, (awaitingByEmployee.get(c.assigneeId) ?? 0) + 1);
    }
  }

  const views: EmployeeStateView[] = employees.map((emp) => {
    const persona = emp.personaJson ? (JSON.parse(emp.personaJson) as { spriteHue?: number; activeInMvp?: boolean }) : {};
    const mine = allTasks
      .filter((x) => x.assigneeId === emp.id)
      .map((x) => ({ ...x, type: x.type as TaskType, status: x.status as TaskStatus }));
    const display = deriveEmployeeDisplay({
      tasks: mine,
      eventsByTask,
      awaitingApprovalCount: awaitingByEmployee.get(emp.id) ?? 0,
      today,
      now,
      staleMinutes: limits.stale.heartbeat_minutes,
    });
    const current = display.currentTaskId ? mine.find((x) => x.id === display.currentTaskId) : undefined;
    return {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      departmentId: emp.departmentId,
      modelProfile: emp.modelProfile,
      activeInMvp: persona.activeInMvp ?? true,
      spriteHue: persona.spriteHue ?? 150,
      display,
      currentTaskTitle: current?.title ?? null,
    };
  });

  const latestRun = db.select().from(t.runs).orderBy(desc(t.runs.startedAt)).limit(1).get();
  return {
    demoMode: getSetting<boolean>(db, "demo_mode") ?? false,
    today,
    run: latestRun
      ? { id: latestRun.id, status: latestRun.status, startedAt: latestRun.startedAt, abnormalNote: latestRun.note }
      : null,
    lastAbnormalRun: latestRun?.status === "aborted",
    employees: views,
    departments,
    counts: {
      awaitingApproval: awaitingPosts.length,
      errors: views.filter((v) => v.display.state === "error" || v.display.state === "stale").length,
      running: views.filter((v) => ["researching", "meeting", "creating", "qa"].includes(v.display.state)).length,
    },
  };
}

export interface EmployeeDetailView {
  employee: { id: string; name: string; role: string; modelProfile: string };
  display: EmployeeDisplay;
  currentTask: (TaskRow & { events: TaskEventRow[] }) | null;
  recentTasks: TaskRow[];
  artifacts: { id: string; kind: string; version: number; createdAt: string; taskId: string; contentJson: string | null }[];
  usage: { estInputChars: number; estOutputChars: number; wallSeconds: number; records: number };
  nextPlanned: { id: string; title: string; status: string }[];
}

export function getEmployeeDetail(db: Db, employeeId: string, now: Date = new Date()): EmployeeDetailView | null {
  const state = getCompanyState(db, now);
  const empView = state.employees.find((e) => e.id === employeeId);
  if (!empView) return null;

  const mine = db
    .select()
    .from(t.tasks)
    .where(eq(t.tasks.assigneeId, employeeId))
    .orderBy(desc(t.tasks.createdAt))
    .limit(20)
    .all() as unknown as TaskRow[];
  const currentTask = empView.display.currentTaskId ? mine.find((x) => x.id === empView.display.currentTaskId) ?? null : null;
  const events = currentTask
    ? (db.select().from(t.taskEvents).where(eq(t.taskEvents.taskId, currentTask.id)).orderBy(asc(t.taskEvents.seq)).all() as unknown as TaskEventRow[])
    : [];
  const mineIds = mine.map((x) => x.id);
  const arts =
    mineIds.length > 0
      ? db
          .select({
            id: t.artifacts.id,
            kind: t.artifacts.kind,
            version: t.artifacts.version,
            createdAt: t.artifacts.createdAt,
            taskId: t.artifacts.taskId,
            contentJson: t.artifacts.contentJson,
          })
          .from(t.artifacts)
          .where(inArray(t.artifacts.taskId, mineIds))
          .orderBy(desc(t.artifacts.createdAt))
          .limit(10)
          .all()
      : [];
  const usage =
    mineIds.length > 0
      ? db
          .select({
            i: sql<number>`coalesce(sum(est_input_chars),0)`,
            o: sql<number>`coalesce(sum(est_output_chars),0)`,
            w: sql<number>`coalesce(sum(wall_seconds),0)`,
            n: sql<number>`count(*)`,
          })
          .from(t.usageRecords)
          .where(inArray(t.usageRecords.taskId, mineIds))
          .get()
      : undefined;

  return {
    employee: { id: empView.id, name: empView.name, role: empView.role, modelProfile: empView.modelProfile },
    display: empView.display,
    currentTask: currentTask ? { ...currentTask, events } : null,
    recentTasks: mine,
    artifacts: arts,
    usage: {
      estInputChars: usage?.i ?? 0,
      estOutputChars: usage?.o ?? 0,
      wallSeconds: usage?.w ?? 0,
      records: usage?.n ?? 0,
    },
    nextPlanned: mine
      .filter((x) => x.status === "queued" || x.status === "pending")
      .map((x) => ({ id: x.id, title: x.title, status: x.status })),
  };
}
