/**
 * ユースケース層 = DBへの唯一の書き込み経路(docs/07, IMPLEMENTATION_HANDOFF 不変条件1)。
 * CLI(エージェント側)とUI APIの双方がここを通る。
 * - 全書き込みはZod検証済みの値のみ
 * - task_events / audit_log はappend-only(UPDATE/DELETE関数を提供しない)
 * - リトライ上限・冪等性・状態遷移ガード・参照存在確認をここで強制
 * - 複数書き込みを伴う操作は1トランザクション(途中失敗で全ロールバック)
 */
import { existsSync, statSync, rmSync, renameSync } from "node:fs";
import nodePath from "node:path";
import { writeBundleToDir, type BundleData } from "../export/bundle-writer";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RunResult } from "better-sqlite3";
import type { Db } from "./client";
import * as t from "./schema";
import * as schema from "./schema";
import { ulid, nowIso, todayLocal, businessDate, addDays } from "../../core/ids";
import { workspaceRoot } from "../root";

/** SQLite: tsカラム(UTC ISO)をAsia/Tokyo業務日で比較する(P1-2) */
const jstDateOfTs = sql<string>`date(ts, '+9 hours')`;
import {
  eventPayloadSchema,
  taskSpecSchema,
  artifactContentSchema,
  carouselSpecSchema,
  imageMetaSchema,
  qaReportArtifactSchema,
  postPlanArtifactSchema,
  copyArtifactSchema,
  newsCopyArtifactSchema,
  portfolioCopyArtifactSchema,
  sourceInputSchema,
  meetingMinutesArtifactSchema,
  type MeetingMinutesArtifact,
  operationSettingsSchema,
  DEFAULT_OPERATION_SETTINGS,
  type OperationSettings,
  permissionScopeSchema,
  SCOPE_NONE,
  type PermissionScope,
  TEMPLATE_IDS,
  SCHEMA_VERSION,
  type EventPayload,
  type TaskSpec,
  type CarouselSpec,
  type QaReport,
  type PostPlan,
  type Copy,
  type NewsCopy,
  type PortfolioCopy,
  type SourceInput,
  type TemplateId,
} from "../../core/schemas";
import { z } from "zod";
import { templateFor, TEMPLATES } from "../../core/templates/index";
import { computeFingerprint } from "../render/fingerprint";
import { resolvePortfolioAssetFile, PortfolioMediaError } from "../render/portfolio-media";
import { distinctInteriorPageCount, MIN_DISTINCT_INTERIOR_PAGES } from "../../core/templates/distinctness";
import { visualQaArtifactSchema, type DesignQaResult, type VisualQaArtifact } from "../../core/schemas";
import {
  collectPublicText,
  scanForbidden,
  containsLatestPhrase,
  matchesSourceRequiredPattern,
} from "../../core/guards";
import { loadForbiddenPhrases, loadQaRules } from "../config";
import { normalizeHttpUrl, assertSafeHttpUrl } from "../../core/urls";

/** 3種のコピー成果物を判別して検証する */
const anyCopySchema = z.union([copyArtifactSchema, newsCopyArtifactSchema, portfolioCopyArtifactSchema]);
export type AnyCopy = Copy | NewsCopy | PortfolioCopy;
import {
  type TaskEventType,
  type TaskStatus,
  type TaskRow,
  type TaskEventRow,
  type TaskType,
} from "../../core/domain";
import {
  assertTaskTransition,
  assertPostTransition,
  deriveEmployeeDisplay,
  type EmployeeDisplay,
} from "../../core/reducers";
import type { PostStatus } from "../../core/domain";
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

/** トランザクション内版。既存キーがあれば既存タスクを返す(冪等) */
function createTaskIn(conn: DbConn, specInput: TaskSpec, runDate: string, actor = "system"): typeof t.tasks.$inferSelect {
  const spec = taskSpecSchema.parse(specInput);
  const key = buildIdempotencyKey(spec, runDate);
  const existing = conn.select().from(t.tasks).where(eq(t.tasks.idempotencyKey, key)).get();
  if (existing) return existing;

  assertEmployeeExists(conn, spec.assigneeId);
  if (spec.postId) assertPostExists(conn, spec.postId);

  const limits = loadLimits();
  const countToday = conn
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
  conn.insert(t.tasks).values(task).run();
  appendEvent(conn, task.id, "created", actor);
  appendEvent(conn, task.id, "queued", actor);
  return conn.select().from(t.tasks).where(eq(t.tasks.id, task.id)).get()!;
}

export function createTask(db: Db, specInput: TaskSpec, runDate: string, actor = "system"): CreateTaskResult {
  const spec = taskSpecSchema.parse(specInput);
  const key = buildIdempotencyKey(spec, runDate);

  // V3-H: 生成系タスクは停止中に作成不可。推定利用量の上限超過で自動停止。
  // 自動停止はタスク作成トランザクションの外で永続化する(ロールバックで消えないように)。
  // 注: 修正依頼(decidePost内のcreateTaskIn)は代表者操作のためこのガードを通らない。
  if (GENERATION_TASK_TYPES.has(spec.type)) {
    const paused = getGenerationPause(db);
    if (paused) {
      throw new Error(`新規生成は停止中です(理由: ${paused.reason})。代表者がダッシュボードから再開してください`);
    }
    const limits = loadLimits();
    const usageToday = db
      .select({ n: sql<number>`coalesce(sum(est_output_chars),0)` })
      .from(t.usageRecords)
      .where(sql`${jstDateOfTs} = ${businessDate()}`)
      .get();
    if ((usageToday?.n ?? 0) >= limits.daily.max_est_output_chars) {
      db.transaction((tx) => pauseGeneration(tx, `推定利用量が日次上限に到達(${usageToday?.n}字 / 上限${limits.daily.max_est_output_chars}字)`, actor));
      throw new Error(`推定利用量の上限に達したため生成を停止しました(本日${usageToday?.n}字)。代表者の再開判断が必要です`);
    }
  }

  return db.transaction((tx): CreateTaskResult => {
    const existing = tx.select().from(t.tasks).where(eq(t.tasks.idempotencyKey, key)).get();
    if (existing) return { task: existing, created: false };
    return { task: createTaskIn(tx, spec, runDate, actor), created: true };
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
    // V3-H: エージェント起動(startedイベント)の日次上限(境界は>=)
    const limits = loadLimits();
    const startedToday = tx
      .select({ n: sql<number>`count(*)` })
      .from(t.taskEvents)
      .where(and(eq(t.taskEvents.type, "started"), sql`${jstDateOfTs} = ${businessDate()}`))
      .get();
    if ((startedToday?.n ?? 0) >= limits.daily.max_agent_launches) {
      throw new Error(
        `本日のエージェント起動上限(${limits.daily.max_agent_launches}回)に達しています(docs/14)。残タスクは翌日に持ち越してください`,
      );
    }
    setTaskStatus(tx, task, "running", { startedAt: nowIso(), finishedAt: null });
    appendEvent(tx, taskId, "started", actor);
  });
}

/**
 * heavyモデルへの昇格記録(V3-H)。日次上限(max_heavy_escalations)を超える昇格は拒否する(境界は>=)。
 * オーケストレーターは昇格前にこれをCLI経由で呼び、拒否されたらstandardのまま実行する。
 */
export function recordHeavyEscalation(db: Db, taskId: string, reason: string, actor: string): { countToday: number } {
  return db.transaction((tx) => {
    getTaskOrThrow(tx, taskId);
    const limits = loadLimits();
    const usedToday = tx
      .select({ n: sql<number>`count(*)` })
      .from(t.auditLog)
      .where(and(eq(t.auditLog.action, "heavy_escalation"), sql`${jstDateOfTs} = ${businessDate()}`))
      .get();
    if ((usedToday?.n ?? 0) >= limits.daily.max_heavy_escalations) {
      throw new Error(
        `本日のheavyモデル昇格上限(${limits.daily.max_heavy_escalations}回)に達しています(docs/14)。standardのまま実行してください`,
      );
    }
    audit(tx, actor, "heavy_escalation", "task", taskId, { reason: reason.slice(0, 200) });
    return { countToday: (usedToday?.n ?? 0) + 1 };
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

/**
 * 成果物バージョン: 投稿に紐づく成果物は (postId, kind) 単位で採番する。
 * 修正依頼→再制作は別タスクになるため、taskId単位では版が繋がらない(AC-17)。
 */
function nextArtifactVersion(conn: DbConn, task: typeof t.tasks.$inferSelect, kind: string): number {
  const scope = task.postId
    ? and(eq(t.artifacts.postId, task.postId), eq(t.artifacts.kind, kind))
    : and(eq(t.artifacts.taskId, task.id), eq(t.artifacts.kind, kind));
  const prev = conn.select({ v: sql<number>`coalesce(max(version), 0)` }).from(t.artifacts).where(scope).get();
  return (prev?.v ?? 0) + 1;
}

function insertContentArtifactIn(
  conn: DbConn,
  task: typeof t.tasks.$inferSelect,
  validated: { kind: string },
  actor: string,
): string {
  const artifactId = ulid();
  conn
    .insert(t.artifacts)
    .values({
      id: artifactId,
      taskId: task.id,
      postId: task.postId,
      kind: validated.kind,
      version: nextArtifactVersion(conn, task, validated.kind),
      contentJson: JSON.stringify(validated),
      filePath: null,
      schemaVersion: SCHEMA_VERSION,
      createdAt: nowIso(),
    })
    .run();
  appendEvent(conn, task.id, "artifact_added", actor, { artifactId });
  return artifactId;
}

function completeTaskIn(
  conn: DbConn,
  task: typeof t.tasks.$inferSelect,
  actor: string,
  opts: { estInputChars?: number; estOutputChars?: number } = {},
): void {
  setTaskStatus(conn, task, "done", { finishedAt: nowIso(), error: null });
  appendEvent(conn, task.id, "succeeded", actor);
  const started = task.startedAt ? new Date(task.startedAt).getTime() : Date.now();
  const ts = nowIso();
  conn
    .insert(t.usageRecords)
    .values({
      id: ulid(),
      taskId: task.id,
      modelProfile: getEmployeeProfile(conn, task.assigneeId),
      estInputChars: opts.estInputChars ?? 0,
      estOutputChars: opts.estOutputChars ?? 0,
      wallSeconds: Math.max(0, Math.round((Date.now() - started) / 1000)),
      ts,
    })
    .run();
  // V3-H(レビュー指摘2): usage_records追加直後に日次合計を再集計し、
  // 上限到達・超過(>=)なら同じ成功トランザクション内で停止を保存する。
  // これにより「その日最後の生成タスクで超過」しても停止状態が確実に残り、
  // 翌日以降も代表者が再開するまで維持される(Maxプラン枠内の推定量であり、API課金の発生ではない)。
  const limits = loadLimits();
  const usageToday = conn
    .select({ n: sql<number>`coalesce(sum(est_output_chars),0)` })
    .from(t.usageRecords)
    .where(sql`${jstDateOfTs} = ${businessDate(new Date(ts))}`)
    .get();
  if ((usageToday?.n ?? 0) >= limits.daily.max_est_output_chars && !getGenerationPause(conn)) {
    pauseGeneration(
      conn,
      `推定利用量が日次上限に到達(${usageToday?.n}字 / 上限${limits.daily.max_est_output_chars}字)`,
      actor,
    );
  }
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

    const artifactId = insertContentArtifactIn(tx, task, validated, actor);

    // 投稿ライフサイクルの自動遷移: 企画(post_plan)提出で idea → drafting(docs/06)
    if (validated.kind === "post_plan" && task.postId) {
      const post = getPostOrThrow(tx, task.postId);
      if (post.status === "idea") setPostStatus(tx, post, "drafting");
    }

    completeTaskIn(tx, task, actor, {
      estInputChars: opts.estInputChars ?? 0,
      estOutputChars: opts.estOutputChars ?? JSON.stringify(validated).length,
    });
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
export function failTask(
  db: Db,
  taskId: string,
  error: string,
  actor: string,
  opts: { fatal?: boolean } = {},
): { retried: boolean } {
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
    // fatal: 同一入力の再試行が無意味な失敗(文字あふれ等)はリトライせず即failed
    if (!opts.fatal && task.retryCount < limits.retry.per_task) {
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

// ---------- 投稿ライフサイクル(docs/06 §3) ----------

function getPostOrThrow(conn: DbConn, postId: string): typeof t.posts.$inferSelect {
  const post = conn.select().from(t.posts).where(eq(t.posts.id, postId)).get();
  if (!post) throw new Error(`投稿が見つかりません: ${postId}`);
  return post;
}

function setPostStatus(
  conn: DbConn,
  post: typeof t.posts.$inferSelect,
  to: PostStatus,
  patch: Partial<typeof t.posts.$inferInsert> = {},
): void {
  assertPostTransition(post.status as PostStatus, to);
  conn.update(t.posts).set({ status: to, ...patch }).where(eq(t.posts.id, post.id)).run();
}

export interface CreatePostInput {
  pillar: "1" | "2" | "3" | "4" | "5" | "6";
  format: string;
  title: string;
  plannedDate?: string;
  templateId?: TemplateId;
  portfolioItemId?: string;
}

export function createPost(db: Db, input: CreatePostInput, actor = "system"): typeof t.posts.$inferSelect {
  const templateId = input.templateId ?? "tpl-howto";
  if (!TEMPLATE_IDS.includes(templateId)) throw new Error(`不明なテンプレートID: ${templateId}`);
  // V3-H: 生成上限・停止状態のガード。
  // 注意: 自動停止(pauseGeneration)は投稿作成トランザクションの外で永続化する
  // (同一トランザクション内で停止→throwすると、ロールバックで停止設定まで消えるため)
  const paused = getGenerationPause(db);
  if (paused) {
    throw new Error(`新規生成は停止中です(理由: ${paused.reason})。代表者がダッシュボードから再開してください`);
  }
  const limits = loadLimits();
  const awaiting = db
    .select({ n: sql<number>`count(*)` })
    .from(t.posts)
    .where(eq(t.posts.status, "awaiting_approval"))
    .get();
  if ((awaiting?.n ?? 0) >= limits.approval_queue.soft_cap) {
    db.transaction((tx) => pauseGeneration(tx, `承認待ちが${awaiting?.n}件(上限${limits.approval_queue.soft_cap})に達したため`, actor));
    throw new Error(
      `承認待ちが${awaiting?.n}件あるため新規生成を停止しました。先に承認キューを処理してください(処理後に代表者が再開)`,
    );
  }
  const today = businessDate();
  const createdToday = db
    .select({ n: sql<number>`count(*)` })
    .from(t.posts)
    .where(eq(t.posts.createdAt, today))
    .get();
  if ((createdToday?.n ?? 0) >= limits.daily.max_generated_posts) {
    throw new Error(`本日の新規投稿上限(${limits.daily.max_generated_posts}本)に達しています(docs/14。通常運用は1本)`);
  }

  return db.transaction((tx) => {
    if (templateId === "tpl-portfolio") {
      if (!input.portfolioItemId) throw new Error("tpl-portfolioにはportfolioItemIdが必要です");
      const item = tx.select().from(t.portfolioItems).where(eq(t.portfolioItems.id, input.portfolioItemId)).get();
      if (!item) throw new Error(`実績が見つかりません: ${input.portfolioItemId}`);
    }

    const id = ulid();
    tx.insert(t.posts)
      .values({
        id,
        pillar: input.pillar,
        format: input.format,
        title: input.title,
        status: "idea",
        plannedDate: input.plannedDate ?? null,
        publishMethod: "manual",
        rightsState: "n/a",
        templateId,
        portfolioItemId: input.portfolioItemId ?? null,
        createdAt: today,
      })
      .run();
    audit(tx, actor, "post_create", "post", id, { title: input.title, pillar: input.pillar, templateId });
    return tx.select().from(t.posts).where(eq(t.posts.id, id)).get()!;
  });
}

/** 予定日の変更(V3-F)。監査ログへ記録。自動投稿・予約投稿は行わない */
export function reschedulePost(db: Db, postId: string, plannedDate: string, actor: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) throw new Error("日付はYYYY-MM-DD形式で指定してください");
  db.transaction((tx) => {
    const post = getPostOrThrow(tx, postId);
    const prev = post.plannedDate;
    tx.update(t.posts).set({ plannedDate }).where(eq(t.posts.id, postId)).run();
    audit(tx, actor, "post_reschedule", "post", postId, { from: prev, to: plannedDate });
  });
}

/**
 * QA合格の前提となる成果物整合性ゲート(P1指摘2, 2026-07-13)。
 * 「最新copy → それを入力に生成したcarousel_spec → そのspecに紐づくPNG一式」の連鎖を
 * 不変ID(sourceCopyArtifactId / specArtifactId)で検証する。version番号の偶然一致に依存しない。
 * 承認(decidePost approved)時にも最終防御として再実行する。
 */
export function assertPostContentIntegrity(conn: DbConn, postId: string): {
  copyArtifactId: string;
  specArtifactId: string;
  imageArtifactIds: string[];
  spec: CarouselSpec;
  copy: AnyCopy;
} {
  const post = getPostOrThrow(conn, postId);
  const copyKind = templateFor(post.templateId).copyKind;
  const arts = conn
    .select()
    .from(t.artifacts)
    .where(eq(t.artifacts.postId, postId))
    .orderBy(desc(t.artifacts.version), desc(t.artifacts.createdAt))
    .all();
  const plan = arts.find((a) => a.kind === "post_plan");
  if (!plan) throw new Error("整合性エラー: 最新のpost_plan成果物がありません");
  const copy = arts.find((a) => a.kind === copyKind);
  if (!copy?.contentJson) throw new Error(`整合性エラー: 最新の${copyKind}成果物がありません`);
  const spec = arts.find((a) => a.kind === "carousel_spec");
  if (!spec?.contentJson) throw new Error("整合性エラー: carousel_specがありません(未レンダリング)");
  let specContent: CarouselSpec;
  let copyContent: AnyCopy;
  try {
    specContent = carouselSpecSchema.parse(JSON.parse(spec.contentJson));
    copyContent = anyCopySchema.parse(JSON.parse(copy.contentJson));
  } catch {
    // 旧形式(sourceCopyArtifactIdなし等)をZod生エラーのまま外へ出さない(V3-J)
    throw new Error(
      `整合性エラー: カルーセル情報が旧形式または不正です。再レンダリングしてください(pnpm company render --post ${postId})`,
    );
  }
  if (specContent.sourceCopyArtifactId !== copy.id) {
    throw new Error(
      `整合性エラー: 最新${copyKind}(v${copy.version})から生成された画像がありません(現在の画像は${copyKind} ${specContent.sourceCopyArtifactId} 由来)。再レンダリングが必要です`,
    );
  }
  const images = arts.filter((a) => {
    if (a.kind !== "image" || !a.contentJson) return false;
    try {
      return imageMetaSchema.parse(JSON.parse(a.contentJson)).specArtifactId === spec.id;
    } catch {
      return false;
    }
  });
  const expected = templateFor(specContent.templateId).expectedPages(specContent);
  if (images.length !== expected) {
    throw new Error(`整合性エラー: 画像枚数が不一致(${images.length}枚 / 期待${expected}枚)`);
  }
  for (const img of images) {
    if (!img.filePath || !existsSync(img.filePath)) {
      throw new Error(`整合性エラー: 画像ファイルが存在しません(${img.filePath ?? img.id})`);
    }
  }
  return {
    copyArtifactId: copy.id,
    specArtifactId: spec.id,
    imageArtifactIds: images.map((a) => a.id),
    spec: specContent,
    copy: copyContent,
  };
}

// ---------- V3: 情報源(sources)・権利(portfolio/permissions)・上限 ----------

export interface LinkedSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  checkedAt: string;
  usable: boolean;
  verificationStatus: string;
  factOrInference: string;
}

export function getLinkedSources(conn: DbConn, postId: string): LinkedSource[] {
  const rows = conn
    .select({
      id: t.sources.id,
      title: t.sources.title,
      url: t.sources.url,
      publisher: t.sources.publisher,
      publishedAt: t.sources.publishedAt,
      checkedAt: t.sources.checkedAt,
      usable: t.sources.usable,
      verificationStatus: t.sources.verificationStatus,
      factOrInference: t.sources.factOrInference,
    })
    .from(t.postSources)
    .innerJoin(t.sources, eq(t.postSources.sourceId, t.sources.id))
    .where(eq(t.postSources.postId, postId))
    .all();
  return rows.map((r) => ({ ...r, usable: r.usable === 1 }));
}

/**
 * source登録(V3-B)。URLはhttp/httpsのみ+正規化して重複防止。
 * 日次のリサーチ取得上限(max_research_fetches)に到達している場合は登録できない(境界は>=)。
 */
export function addSource(db: Db, input: SourceInput, actor: string): { id: string; created: boolean } {
  const parsed = sourceInputSchema.parse(input);
  parsed.url = normalizeHttpUrl(parsed.url, "source URL");
  return db.transaction((tx) => {
    const existing = tx.select().from(t.sources).where(eq(t.sources.url, parsed.url)).get();
    if (existing) return { id: existing.id, created: false };

    const limits = loadLimits();
    const today = businessDate();
    const fetchedToday = tx
      .select({ n: sql<number>`count(*)` })
      .from(t.sources)
      .where(eq(t.sources.checkedAt, today))
      .get();
    if ((fetchedToday?.n ?? 0) >= limits.daily.max_research_fetches) {
      throw new Error(
        `本日のリサーチ取得上限(${limits.daily.max_research_fetches}件)に達しています(docs/14)。明日以降に登録するか、代表者にlimits.yamlの見直しを相談してください`,
      );
    }
    const unverified = !parsed.fetched || !parsed.publishedAt;
    const id = ulid();
    tx.insert(t.sources)
      .values({
        id,
        title: parsed.title,
        url: parsed.url,
        publisher: parsed.publisher,
        publishedAt: parsed.publishedAt ?? "",
        checkedAt: businessDate(),
        isPrimary: parsed.isPrimary ? 1 : 0,
        reliability: parsed.reliability,
        summary: parsed.summary,
        factOrInference: parsed.factOrInference,
        fetchedAt: parsed.fetched ? nowIso() : null,
        usable: unverified ? 0 : 1,
        verificationStatus: unverified ? "unconfirmed" : "confirmed",
      })
      .run();
    audit(tx, actor, "source_add", "source", id, { url: parsed.url, unverified });
    return { id, created: true };
  });
}

export function linkSourceToPost(db: Db, postId: string, sourceId: string, actor: string): { created: boolean } {
  return db.transaction((tx) => {
    getPostOrThrow(tx, postId);
    const src = tx.select().from(t.sources).where(eq(t.sources.id, sourceId)).get();
    if (!src) throw new Error(`sourceが見つかりません: ${sourceId}`);
    const existing = tx
      .select()
      .from(t.postSources)
      .where(and(eq(t.postSources.postId, postId), eq(t.postSources.sourceId, sourceId)))
      .get();
    if (existing) return { created: false };
    tx.insert(t.postSources).values({ postId, sourceId, citedAs: null }).run();
    audit(tx, actor, "source_link", "post", postId, { sourceId });
    return { created: true };
  });
}

export interface RightsCheck {
  allowed: boolean;
  mode: "customer" | "anonymous" | null;
  displayName: string | null;
  reason: string | null;
  /** 項目別の利用可否(V3レビュー指摘1: scope_jsonをZodで解析し個別判定) */
  allowedUses: PermissionScope;
}

const NO_USES: PermissionScope = { ...SCOPE_NONE };

/** scope_jsonの安全な解析。不正・欠落は全不許可として扱う */
export function parsePermissionScope(scopeJson: string | null): PermissionScope {
  if (!scopeJson) return { ...NO_USES };
  try {
    return permissionScopeSchema.parse(JSON.parse(scopeJson));
  } catch {
    return { ...NO_USES };
  }
}

export const EVIDENCE_DIR = "07_customer-permissions";

/**
 * 許可証跡パスの検証(V3再レビューP1-3)。任意文字列を信用しない。
 * - data/workspace/07_customer-permissions/ 配下の安全な相対パスのみ
 * - 絶対パス・「..」・フォルダ外参照・存在しないファイル・ディレクトリを拒否
 * - approved / anonymousAllowed の判定時にも通常ファイルの実在を確認する
 */
export function evidenceFileStatus(rel: string | null | undefined): { ok: boolean; reason: string | null } {
  const raw = rel?.trim();
  if (!raw) return { ok: false, reason: "証跡(evidencePath)が未登録です" };
  const p = raw.replaceAll("\\", "/");
  if (nodePath.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) {
    return { ok: false, reason: "証跡パスに絶対パスは使用できません(07_customer-permissions/ からの相対パスのみ)" };
  }
  if (p.split("/").includes("..")) {
    return { ok: false, reason: "証跡パスに「..」は使用できません" };
  }
  if (!p.startsWith(`${EVIDENCE_DIR}/`)) {
    return { ok: false, reason: `証跡は data/workspace/${EVIDENCE_DIR}/ 配下のみ許可されます(例: ${EVIDENCE_DIR}/顧客名-同意DM.png)` };
  }
  const workspace = workspaceRoot();
  const abs = nodePath.resolve(workspace, p);
  const dir = nodePath.resolve(workspace, EVIDENCE_DIR) + nodePath.sep;
  if (!abs.startsWith(dir)) {
    return { ok: false, reason: "証跡パスが許可フォルダの外を参照しています" };
  }
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { ok: false, reason: `証跡がファイルではありません(${p})` };
  } catch {
    return { ok: false, reason: `証跡ファイルが存在しません(${p})。先に07_customer-permissions/へ保存してください` };
  }
  return { ok: true, reason: null };
}

/**
 * 実績素材の公開可否(V3-C)。通常コードで判定し、AIプロンプトへ渡す前にも使用する。
 * - approvedでも scope.name=false なら実名は使えない(匿名許可+匿名名があれば匿名で利用)
 * - 匿名利用は anonymousAllowed=true かつ 証跡(evidencePath)がある場合のみ
 * - rejected / revoked / 期限切れは全利用不可
 */
export function checkPortfolioRights(conn: DbConn, portfolioItemId: string): RightsCheck {
  const deny = (reason: string): RightsCheck => ({ allowed: false, mode: null, displayName: null, reason, allowedUses: { ...NO_USES } });
  const item = conn.select().from(t.portfolioItems).where(eq(t.portfolioItems.id, portfolioItemId)).get();
  if (!item) return deny("実績が見つかりません");
  const perm = item.permissionId
    ? conn.select().from(t.customerPermissions).where(eq(t.customerPermissions.id, item.permissionId)).get()
    : undefined;
  if (!perm) return deny("公開許可レコードがありません(実績画面で許可を記録してください)");
  if (perm.status === "rejected" || perm.status === "revoked") {
    return deny(`公開許可がありません(状態: ${perm.status})`);
  }
  if (perm.expiresAt && perm.expiresAt < businessDate()) {
    return deny(`公開許可の期限が切れています(${perm.expiresAt})`);
  }

  // 証跡は「記録されている」だけでなく、実在する通常ファイルであることを判定時にも確認する(P1-3)
  const evidence = evidenceFileStatus(perm.evidencePath);
  const anonymousOk = perm.anonymousAllowed === 1 && !!item.anonymousName && evidence.ok;

  if (perm.status === "approved") {
    if (!evidence.ok) {
      return deny(`承認済みですが証跡が確認できません: ${evidence.reason}`);
    }
    const scope = parsePermissionScope(perm.scopeJson);
    if (scope.name) {
      return { allowed: true, mode: "customer", displayName: item.customerName, reason: null, allowedUses: scope };
    }
    if (anonymousOk) {
      // 実名は不可だが匿名で利用可。実名系のname/urlは不許可のまま項目別scopeに従う
      return { allowed: true, mode: "anonymous", displayName: item.anonymousName!, reason: null, allowedUses: { ...scope, name: false } };
    }
    return deny("許可範囲に実名(name)が含まれず、匿名利用も許可されていません(scope設定または匿名許可+証跡が必要)");
  }
  // pending
  if (anonymousOk) {
    return { allowed: true, mode: "anonymous", displayName: item.anonymousName!, reason: null, allowedUses: { ...NO_USES } };
  }
  if (perm.anonymousAllowed === 1 && !evidence.ok) {
    return deny(`匿名利用の許可にも証跡の確認が必要です: ${evidence.reason}`);
  }
  return deny("公開許可が未取得(pending)です。匿名利用も許可されていないため使用できません");
}

interface CustomerDataViolation {
  item: string;
  kind: "name" | "url" | "testimonial";
  detail: string;
}

/**
 * 許可範囲外の顧客データ(実名・URL・お客様の声)が公開テキストに含まれていないかの通常コード検査。
 * AI入力へ渡す前の検査(listPortfolioForAi)と対になる出口側の防御。
 */
function findCustomerDataViolations(conn: DbConn, text: string): CustomerDataViolation[] {
  const violations: CustomerDataViolation[] = [];
  const items = conn.select().from(t.portfolioItems).all();
  for (const item of items) {
    const rc = checkPortfolioRights(conn, item.id);
    const name = item.customerName.trim();
    if (name.length >= 2 && text.includes(name) && !(rc.mode === "customer" && rc.allowedUses.name)) {
      violations.push({ item: item.id, kind: "name", detail: `顧客名「${name}」(許可範囲外)` });
    }
    const siteUrl = item.siteUrl?.trim();
    if (siteUrl && siteUrl.length >= 10 && text.includes(siteUrl) && !rc.allowedUses.url) {
      violations.push({ item: item.id, kind: "url", detail: `顧客URL(scope.url未許可)` });
    }
    const testimonial = item.testimonial?.trim();
    if (testimonial && testimonial.length >= 10 && text.includes(testimonial) && !rc.allowedUses.testimonial) {
      violations.push({ item: item.id, kind: "testimonial", detail: "お客様の声(scope.testimonial未許可)" });
    }
  }
  return violations;
}

/**
 * AIプロンプトへ渡してよい形に許可範囲でマスクした実績ビュー(V3レビュー指摘1)。
 * CLIのportfolio-list(オーケストレーター向け)はこれを返す。UI(代表者)向けはlistPortfolioを使う。
 */
export interface PortfolioAiView {
  id: string;
  displayName: string | null; // 許可された表示名(なければnull=利用不可)
  usable: boolean;
  reason: string | null;
  allowedUses: PermissionScope;
  siteUrl: string | null; // scope.url=trueの場合のみ
  testimonial: string | null; // scope.testimonial=trueの場合のみ
  assetsPath: string | null; // scope.screenshot=trueの場合のみ(レンダラー・AIへ渡してよい素材)
  summary: string | null;
  problem: string | null;
  technologies: string[];
}

export function listPortfolioForAi(db: Db): PortfolioAiView[] {
  const items = db.select().from(t.portfolioItems).orderBy(desc(t.portfolioItems.createdAt)).all();
  return items.map((item): PortfolioAiView => {
    const rc = checkPortfolioRights(db, item.id);
    // P1-1: 利用不可(pending/rejected/revoked/期限切れ/不正scope/証跡なし)の実績は
    // 顧客由来情報を一切返さない(存在と不可理由のみ)。
    if (!rc.allowed) {
      return {
        id: item.id,
        displayName: null,
        usable: false,
        reason: rc.reason,
        allowedUses: { ...SCOPE_NONE },
        siteUrl: null,
        testimonial: null,
        assetsPath: null,
        summary: null,
        problem: null,
        technologies: [],
      };
    }
    // 利用可能な場合のみ、許可された範囲の情報を返す(匿名モードでは匿名名+非特定情報)
    return {
      id: item.id,
      displayName: rc.displayName,
      usable: true,
      reason: null,
      allowedUses: rc.allowedUses,
      siteUrl: rc.allowedUses.url ? (item.siteUrl ?? null) : null,
      testimonial: rc.allowedUses.testimonial ? (item.testimonial ?? null) : null,
      assetsPath: rc.allowedUses.screenshot ? (item.assetsPath ?? null) : null,
      summary: item.summary ?? null,
      problem: item.problem ?? null,
      technologies: item.technologiesJson ? (JSON.parse(item.technologiesJson) as string[]) : [],
    };
  });
}

/** 公開テキストの通常コード検査(禁止語・顧客名漏えい・source要求)。QA提出時と承認時の両方で使う */
function assertPublicTextSafety(conn: DbConn, post: typeof t.posts.$inferSelect, copy: AnyCopy): void {
  const text = collectPublicText(copy);
  const forbidden = scanForbidden(text, loadForbiddenPhrases());
  if (forbidden.length > 0) {
    throw new Error(
      `禁止表現を検出: ${forbidden.map((h) => `${h.label}「${h.sample}」`).join(" / ")}(config/forbidden-phrases.yaml)`,
    );
  }
  const violations = findCustomerDataViolations(conn, text);
  if (violations.length > 0) {
    throw new Error(
      `公開許可のない顧客名がテキストに含まれています / 許可範囲外の顧客データ: ${violations.map((v) => v.detail).join(", ")}(実績画面で許可範囲を記録してください)`,
    );
  }
  const rules = loadQaRules();
  const linked = getLinkedSources(conn, post.id);
  const usableConfirmed = linked.filter((s) => s.usable && s.verificationStatus === "confirmed");
  if (rules.require_sources_for_pillars.includes(post.pillar) && usableConfirmed.length === 0) {
    throw new Error("ニュース系投稿は確認済みsourceの紐付けが必須です(company source-add → source-link)");
  }
  const latestPhrase = containsLatestPhrase(text, rules);
  if (latestPhrase && !linked.some((s) => s.publishedAt && s.checkedAt)) {
    throw new Error(`「${latestPhrase}」は公開日と確認日の揃ったsourceがある場合のみ使用できます`);
  }
  const claimPattern = matchesSourceRequiredPattern(text, rules);
  if (claimPattern && usableConfirmed.length < rules.min_sources_for_strong_claims) {
    throw new Error(
      `統計・調査系の主張には確認済みsourceが${rules.min_sources_for_strong_claims}件以上必要です(現在${usableConfirmed.length}件。単一情報源で断定しない)`,
    );
  }
}

/** 実績投稿の権利+spec表示名の再検証(QA時・承認時共通) */
function assertPortfolioRightsForPost(
  conn: DbConn,
  post: typeof t.posts.$inferSelect,
  spec: CarouselSpec | null,
): void {
  if (!post.portfolioItemId) return;
  const rc = checkPortfolioRights(conn, post.portfolioItemId);
  if (!rc.allowed) {
    throw new Error(`権利確認が未了です: ${rc.reason} — QAは result="blocked_rights" で提出してください`);
  }
  if (spec && spec.templateId === "tpl-portfolio") {
    const expectAnonymous = rc.mode === "anonymous";
    if (spec.anonymous !== expectAnonymous || spec.displayName !== rc.displayName) {
      throw new Error(
        `表示名が現在の許可状態と一致しません(画像: ${spec.displayName}${spec.anonymous ? "・匿名" : ""} / 許可: ${rc.displayName}${expectAnonymous ? "・匿名" : ""})。再レンダリングしてください`,
      );
    }
    if (spec.portfolioMedia.mode === "real_screenshot") {
      if (!rc.allowedUses.screenshot) {
        throw new Error("実績画像の公開許可(scope.screenshot)が現在は無効です。再レンダリングしてください");
      }
      const item = conn.select().from(t.portfolioItems).where(eq(t.portfolioItems.id, post.portfolioItemId)).get();
      if (!item) throw new Error("実績素材が見つかりません。再レンダリングしてください");
      try {
        const current = resolvePortfolioAssetFile(item.id, item.assetsPath);
        if (
          current.assetSha256 !== spec.portfolioMedia.assetSha256
          || current.safeRelativePath !== spec.portfolioMedia.safeRelativePath
        ) {
          throw new Error("実績画像がレンダリング後に差し替えられています。再レンダリング・再QAが必要です");
        }
      } catch (error) {
        if (error instanceof PortfolioMediaError) {
          throw new Error(`実績画像を再確認できません: ${error.message}。再レンダリングしてください`);
        }
        throw error;
      }
    } else if (spec.layoutVariant === "showcase" || !spec.layoutVariant) {
      throw new Error("showcase画像に実績スクリーンショットの記録がありません。storyで再生成するか、画像許可を記録してください");
    }
  }
}

/** 生成の一時停止(V3-H)。代表者がUIから明示的に再開するまで解除しない */
export interface GenerationPause {
  reason: string;
  pausedAt: string;
  pausedBy: string;
}

export function getGenerationPause(conn: DbConn): GenerationPause | null {
  return getSetting<GenerationPause>(conn, "generation_paused");
}

export function pauseGeneration(conn: DbConn, reason: string, actor: string): void {
  setSetting(conn, "generation_paused", { reason, pausedAt: nowIso(), pausedBy: actor } satisfies GenerationPause);
  audit(conn, actor, "generation_pause", "settings", "generation_paused", { reason });
}

export function resumeGeneration(db: Db, actor: string): void {
  if (actor !== "owner") throw new Error("生成の再開は代表者(owner)のみが行えます");
  db.transaction((tx) => {
    tx.delete(t.settings).where(eq(t.settings.key, "generation_paused")).run();
    audit(tx, actor, "generation_resume", "settings", "generation_paused");
  });
}

const GENERATION_TASK_TYPES = new Set(["plan_posts", "write_copy", "design", "render"]);

/**
 * QA提出(紫苑のタスク完了+qa_reviews記録+投稿遷移を1トランザクションで)。
 * pass: drafting→qa_review→awaiting_approval / fail: →qa_review→drafting(差し戻し)。
 * QA合格のみが承認キューへ進む(§14, AC-15)。
 * passには成果物整合性ゲート(assertPostContentIntegrity)を通過する必要がある(P1指摘2)。
 */
export function submitQa(db: Db, taskId: string, content: unknown, actor: string): SubmitResult & { result: QaReport["result"] } {
  const report = qaReportArtifactSchema.parse(content);
  return db.transaction((tx) => {
    const task = getTaskOrThrow(tx, taskId);
    if (task.type !== "qa") throw new Error(`QA提出はtype=qaのタスクからのみ可能です(現在: ${task.type})`);
    if (task.assigneeId !== "emp_shion") {
      throw new Error(`QA提出は品質管理担当(emp_shion)のタスクからのみ可能です(現在: ${task.assigneeId})`);
    }
    if (task.status !== "running") throw new Error(`runningでないタスクには提出できません(現在: ${task.status})`);
    if (!task.postId) throw new Error("QAタスクにpostIdがありません");
    const post = getPostOrThrow(tx, task.postId);

    const rules = loadQaRules();
    if (report.result === "pass") {
      // 構造ルール(V3-A): AIの自己申告と矛盾するpassを構造的に拒否
      if (rules.pass_requires_all_checklist_ok && report.checklist.some((c) => !c.ok)) {
        throw new Error("passなのにchecklistに不合格項目(ok=false)があります。failまたは項目の再確認が必要です");
      }
      if (rules.pass_requires_no_issues && report.issues.length > 0) {
        throw new Error("重大指摘(issues)が残る状態ではpassできません。軽微な指摘はnotesへ、重大ならfailにしてください");
      }
      // 成果物整合性(最新copy→spec→PNG一式)
      const integrity = assertPostContentIntegrity(tx, post.id);
      // 通常コード検査: 禁止語・顧客名漏えい・source要求(AIの申告に依存しない)
      assertPublicTextSafety(tx, post, integrity.copy);
      // 権利: 実績投稿は許可記録がなければQA合格不可
      assertPortfolioRightsForPost(tx, post, integrity.spec);
    }

    const artifactId = insertContentArtifactIn(tx, task, report, actor);
    tx.insert(t.qaReviews)
      .values({
        id: ulid(),
        postId: post.id,
        artifactId,
        result: report.result,
        checklistJson: JSON.stringify(report.checklist),
        issuesJson: JSON.stringify(report.issues),
        notesJson: JSON.stringify(report.notes),
        reviewerId: task.assigneeId,
        createdAt: nowIso(),
      })
      .run();

    if (post.status === "drafting") setPostStatus(tx, post, "qa_review");
    const inReview = getPostOrThrow(tx, post.id);
    if (report.result === "pass") {
      setPostStatus(tx, inReview, "awaiting_approval", { rightsState: post.portfolioItemId ? "clear" : inReview.rightsState });
    } else if (report.result === "blocked_rights") {
      // 権利確認待ち: 承認キューへ進めず、rights_stateで識別する(V3-A, docs/06)
      setPostStatus(tx, inReview, "drafting", { rightsState: "blocked_rights" });
    } else {
      setPostStatus(tx, inReview, "drafting");
    }
    audit(tx, actor, "qa_review", "post", post.id, {
      result: report.result,
      issues: report.issues.length,
      notes: report.notes.length,
    });
    completeTaskIn(tx, task, actor, { estOutputChars: JSON.stringify(report).length });
    return { artifactId, result: report.result };
  });
}

/** レンダリング成果物の登録(通常コードのレンダラーから呼ぶ)。spec+画像+タスク完了を1トランザクションで */
export function addRenderArtifacts(
  db: Db,
  taskId: string,
  spec: CarouselSpec,
  files: string[],
  actor = "system",
): { specArtifactId: string; imageArtifactIds: string[] } {
  const validated = carouselSpecSchema.parse(spec);
  if (files.length === 0) throw new Error("画像ファイルがありません");
  return db.transaction((tx) => {
    const task = getTaskOrThrow(tx, taskId);
    if (task.status !== "running") throw new Error(`runningでないタスクには登録できません(現在: ${task.status})`);
    const specArtifactId = insertContentArtifactIn(tx, task, validated, actor);
    const batchVersion = nextArtifactVersion(tx, task, "image");
    const imageArtifactIds: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const meta = imageMetaSchema.parse({
        specArtifactId,
        sourceCopyArtifactId: validated.sourceCopyArtifactId,
        page: i + 1,
        pageCount: files.length,
      });
      const id = ulid();
      tx.insert(t.artifacts)
        .values({
          id,
          taskId: task.id,
          postId: task.postId,
          kind: "image",
          version: batchVersion,
          contentJson: JSON.stringify(meta),
          filePath: file,
          schemaVersion: SCHEMA_VERSION,
          createdAt: nowIso(),
        })
        .run();
      imageArtifactIds.push(id);
    }
    appendEvent(tx, taskId, "stage_changed", actor, { stage: `画像${files.length}枚を生成` });
    completeTaskIn(tx, task, actor, { estOutputChars: 0 });
    return { specArtifactId, imageArtifactIds };
  });
}

export type Decision = "approved" | "rejected" | "revision_requested";

/**
 * 代表者の承認・却下・修正依頼(AC-16/17)。
 * **呼び出し元はNext.js UI/APIのみ**(company CLIからは実行不可 — P1指摘1でCLIのdecideコマンドを削除済み)。
 * - actorにデフォルトはない。UI層が明示的に "owner" を渡す
 * - approvals(append-only)+audit_logに必ず記録
 * - 却下・修正依頼は理由必須
 * - 承認時は最終防御として最新QA(pass)と最新成果物の整合性を再検証する
 * - 修正依頼は琴葉の修正タスクを自動生成し、投稿をdraftingへ戻す
 */
export function decidePost(
  db: Db,
  postId: string,
  decision: Decision,
  comment: string | null,
  actor: string,
): { approvalId: string; revisionTaskId?: string } {
  if ((decision === "rejected" || decision === "revision_requested") && !comment?.trim()) {
    throw new Error("却下・修正依頼には理由(コメント)が必要です");
  }
  return db.transaction((tx) => {
    const post = getPostOrThrow(tx, postId);
    if (post.status !== "awaiting_approval") {
      throw new Error(`承認待ちでない投稿には判断できません(現在: ${post.status})`);
    }
    if (decision === "approved") {
      // 最終防御(P1指摘2+V3-A): 整合性・最新QA合格・権利・禁止語を承認時点でも再検証
      if (post.rightsState === "blocked_rights") {
        throw new Error("権利確認待ちの投稿は承認できません(実績画面で許可を記録し、再QAが必要です)");
      }
      const integrity = assertPostContentIntegrity(tx, postId);
      const latestQa = tx
        .select()
        .from(t.qaReviews)
        .where(eq(t.qaReviews.postId, postId))
        .orderBy(desc(t.qaReviews.createdAt))
        .limit(1)
        .get();
      if (!latestQa || latestQa.result !== "pass") {
        throw new Error(`整合性エラー: 最新のQA結果が合格ではありません(${latestQa?.result ?? "QAなし"})`);
      }
      assertPublicTextSafety(tx, post, integrity.copy);
      assertPortfolioRightsForPost(tx, post, integrity.spec);
    }
    const approvalId = ulid();
    tx.insert(t.approvals)
      .values({
        id: approvalId,
        subjectType: "post",
        subjectId: postId,
        decision,
        comment: comment?.trim() || null,
        decidedBy: actor,
        decidedAt: nowIso(),
      })
      .run();
    audit(tx, actor, decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "revise", "post", postId, {
      comment: comment?.slice(0, 200),
    });

    if (decision === "approved") {
      setPostStatus(tx, post, "approved");
      return { approvalId };
    }
    if (decision === "rejected") {
      setPostStatus(tx, post, "rejected");
      return { approvalId };
    }
    // 修正依頼: revision_requested → drafting + 修正タスク生成(AC-17)
    setPostStatus(tx, post, "revision_requested");
    const revCount = tx
      .select({ n: sql<number>`count(*)` })
      .from(t.approvals)
      .where(and(eq(t.approvals.subjectId, postId), eq(t.approvals.decision, "revision_requested")))
      .get();
    const spec = taskSpecSchema.parse({
      type: "write_copy",
      title: `修正対応: ${post.title}`.slice(0, 120),
      assigneeId: "emp_kotoha",
      postId,
      stepKey: `copy-rev${revCount?.n ?? 1}`,
      priority: 3,
      input: { revisionComment: comment?.slice(0, 500) },
    });
    const revisionTask = createTaskIn(tx, spec, todayLocal(), actor);
    const afterRev = getPostOrThrow(tx, postId);
    setPostStatus(tx, afterRev, "drafting");
    return { approvalId, revisionTaskId: revisionTask.id };
  });
}

export interface ApprovalQueueItem {
  post: typeof t.posts.$inferSelect;
  plan: Record<string, unknown> | null;
  copy: Record<string, unknown> | null;
  copyVersion: number | null;
  qa: { result: string; checklist: unknown; issues: string[]; notes: string[]; createdAt: string } | null;
  imageArtifactIds: string[];
  decisions: { decision: string; comment: string | null; decidedAt: string }[];
  /** 紐付いた情報源(URL・日付を承認画面で確認できる。V3-B) */
  sources: LinkedSource[];
  /** 整合性・形式に問題がある場合の日本語説明(V3-J)。設定時は承認不可として表示 */
  integrityError: string | null;
}

export function listApprovalQueue(db: Db): ApprovalQueueItem[] {
  const posts = db.select().from(t.posts).where(eq(t.posts.status, "awaiting_approval")).orderBy(asc(t.posts.plannedDate)).all();
  return posts.map((post): ApprovalQueueItem => {
    // 1投稿の破損でキュー全体を落とさない(V3-J)
    try {
      const arts = db
        .select()
        .from(t.artifacts)
        .where(eq(t.artifacts.postId, post.id))
        .orderBy(desc(t.artifacts.version), desc(t.artifacts.createdAt))
        .all();
      const copyKind = templateFor(post.templateId).copyKind;
      const copy = arts.find((a) => a.kind === copyKind);
      const plan = arts.find((a) => a.kind === "post_plan");
      const latestImageVersion = arts.find((a) => a.kind === "image")?.version ?? null;
      const images = latestImageVersion
        ? arts
            .filter((a) => a.kind === "image" && a.version === latestImageVersion)
            .sort((a, b) => (a.filePath ?? "").localeCompare(b.filePath ?? ""))
        : [];
      const qaRow = db.select().from(t.qaReviews).where(eq(t.qaReviews.postId, post.id)).orderBy(desc(t.qaReviews.createdAt)).limit(1).get();
      const decisions = db
        .select()
        .from(t.approvals)
        .where(and(eq(t.approvals.subjectType, "post"), eq(t.approvals.subjectId, post.id)))
        .orderBy(desc(t.approvals.decidedAt))
        .all();
      let integrityError: string | null = null;
      try {
        assertPostContentIntegrity(db, post.id);
      } catch (e) {
        integrityError = e instanceof Error ? e.message : String(e);
      }
      return {
        post,
        plan: plan?.contentJson ? (JSON.parse(plan.contentJson) as Record<string, unknown>) : null,
        copy: copy?.contentJson ? (JSON.parse(copy.contentJson) as Record<string, unknown>) : null,
        copyVersion: copy?.version ?? null,
        qa: qaRow
          ? {
              result: qaRow.result,
              checklist: qaRow.checklistJson ? JSON.parse(qaRow.checklistJson) : [],
              issues: qaRow.issuesJson ? (JSON.parse(qaRow.issuesJson) as string[]) : [],
              notes: qaRow.notesJson ? (JSON.parse(qaRow.notesJson) as string[]) : [],
              createdAt: qaRow.createdAt,
            }
          : null,
        imageArtifactIds: images.map((a) => a.id),
        decisions: decisions.map((d) => ({ decision: d.decision, comment: d.comment, decidedAt: d.decidedAt })),
        sources: getLinkedSources(db, post.id),
        integrityError,
      };
    } catch (e) {
      return {
        post,
        plan: null,
        copy: null,
        copyVersion: null,
        qa: null,
        imageArtifactIds: [],
        decisions: [],
        sources: [],
        integrityError: `この投稿のデータを読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}

export function getArtifactFile(db: Db, artifactId: string): { filePath: string } | null {
  const a = db.select().from(t.artifacts).where(eq(t.artifacts.id, artifactId)).get();
  if (!a?.filePath) return null;
  return { filePath: a.filePath };
}

/** 投稿の最新コンテンツ(plan+テンプレートに応じたコピー)。レンダラーが使用 */
export function getPostContent(
  db: Db,
  postId: string,
): {
  post: typeof t.posts.$inferSelect;
  plan: PostPlan | null;
  copy: AnyCopy | null;
  copyVersion: number | null;
  copyArtifactId: string | null;
} {
  const post = getPostOrThrow(db, postId);
  const copyKind = templateFor(post.templateId).copyKind;
  const arts = db
    .select()
    .from(t.artifacts)
    .where(eq(t.artifacts.postId, postId))
    .orderBy(desc(t.artifacts.version), desc(t.artifacts.createdAt))
    .all();
  const planRow = arts.find((a) => a.kind === "post_plan");
  const copyRow = arts.find((a) => a.kind === copyKind);
  return {
    post,
    plan: planRow?.contentJson ? postPlanArtifactSchema.parse(JSON.parse(planRow.contentJson)) : null,
    copy: copyRow?.contentJson ? anyCopySchema.parse(JSON.parse(copyRow.contentJson)) : null,
    copyVersion: copyRow?.version ?? null,
    copyArtifactId: copyRow?.id ?? null,
  };
}

// ---------- V3-C: 実績素材・公開許可(書き込みは代表者のUI/S-06から) ----------

export interface PortfolioInput {
  customerName: string;
  siteUrl?: string;
  anonymousName?: string;
  summary?: string;
  technologies?: string[];
  problem?: string;
  testimonial?: string;
  assetsPath?: string;
}

/** 実績登録。公開許可は初期状態pending(既存実績3件も登録時はpendingから始める) */
export function addPortfolioItem(db: Db, input: PortfolioInput, actor: string): { itemId: string; permissionId: string } {
  if (!input.customerName?.trim()) throw new Error("顧客名は必須です");
  if (input.siteUrl?.trim()) {
    input.siteUrl = normalizeHttpUrl(input.siteUrl.trim(), "顧客URL"); // http/httpsのみ許可(V3レビュー指摘4)
  }
  return db.transaction((tx) => {
    const permissionId = ulid();
    tx.insert(t.customerPermissions)
      .values({
        id: permissionId,
        customerName: input.customerName.trim(),
        scopeJson: JSON.stringify({ name: false, url: false, screenshot: false, testimonial: false }),
        status: "pending",
        evidencePath: null,
        grantedAt: null,
        expiresAt: null,
        anonymousAllowed: 0,
        revokedAt: null,
      })
      .run();
    const itemId = ulid();
    tx.insert(t.portfolioItems)
      .values({
        id: itemId,
        customerName: input.customerName.trim(),
        siteUrl: input.siteUrl?.trim() || null,
        assetsPath: input.assetsPath?.trim() || null,
        highlightsJson: null,
        permissionId,
        createdAt: nowIso(),
        anonymousName: input.anonymousName?.trim() || null,
        summary: input.summary?.trim() || null,
        technologiesJson: input.technologies ? JSON.stringify(input.technologies) : null,
        problem: input.problem?.trim() || null,
        testimonial: input.testimonial?.trim() || null,
      })
      .run();
    audit(tx, actor, "portfolio_add", "portfolio_item", itemId, { customerName: input.customerName.trim() });
    return { itemId, permissionId };
  });
}

/** 代表者がアップロード済みの安全な実績画像を実績レコードへ紐付ける。 */
export function updatePortfolioAssetsPath(db: Db, portfolioItemId: string, assetsPath: string, actor: string): void {
  if (actor !== "owner") throw new Error("実績画像の登録は代表者(owner)のみが行えます");
  const item = db.select().from(t.portfolioItems).where(eq(t.portfolioItems.id, portfolioItemId)).get();
  if (!item) throw new Error(`実績が見つかりません: ${portfolioItemId}`);
  const resolved = resolvePortfolioAssetFile(portfolioItemId, assetsPath);
  db.transaction((tx) => {
    tx.update(t.portfolioItems)
      .set({ assetsPath: resolved.safeRelativePath })
      .where(eq(t.portfolioItems.id, portfolioItemId))
      .run();
    audit(tx, actor, "portfolio_asset_uploaded", "portfolio_item", portfolioItemId, {
      safeRelativePath: resolved.safeRelativePath,
      assetSha256: resolved.assetSha256,
    });
  });
}

export interface PermissionUpdate {
  status: "pending" | "approved" | "rejected" | "revoked";
  scope?: PermissionScope;
  anonymousAllowed?: boolean;
  evidencePath?: string;
  grantedAt?: string;
  expiresAt?: string;
}

/**
 * 公開許可の記録・変更(代表者のみ。UIから)。すべて監査ログへ。
 * - approved: 証跡必須+scope(4項目の個別選択)必須。一括固定scopeは廃止(V3レビュー指摘1)
 * - anonymousAllowed=true: 証跡必須(匿名利用にも同意記録が必要)
 * - 許可変更後、既存の承認待ち投稿は承認時の再検査(assertPortfolioRightsForPost)で
 *   表示名・許可状態との不整合が検出され、再レンダリング+再QAが要求される
 */
export function updatePermission(db: Db, permissionId: string, update: PermissionUpdate, actor: string): void {
  if (actor !== "owner") throw new Error("公開許可の記録・変更は代表者(owner)のみが行えます");
  db.transaction((tx) => {
    const perm = tx.select().from(t.customerPermissions).where(eq(t.customerPermissions.id, permissionId)).get();
    if (!perm) throw new Error(`許可レコードが見つかりません: ${permissionId}`);
    const evidence = update.evidencePath?.trim() || perm.evidencePath;
    const nextAnonymous = update.anonymousAllowed === undefined ? perm.anonymousAllowed === 1 : update.anonymousAllowed;
    // P1-3: 証跡パスは任意文字列として信用せず、07_customer-permissions/配下の実在ファイルのみ受け付ける
    if (update.status === "approved" || nextAnonymous) {
      const st = evidenceFileStatus(evidence);
      if (!st.ok) {
        throw new Error(`許可を記録できません: ${st.reason}(Q4: 同意記録の保存)`);
      }
    }
    if (update.status === "approved" && !update.scope) {
      throw new Error("承認(approved)には許可範囲(scope: name/url/screenshot/testimonial)の個別指定が必要です");
    }
    tx.update(t.customerPermissions)
      .set({
        status: update.status,
        scopeJson: update.scope ? JSON.stringify(permissionScopeSchema.parse(update.scope)) : perm.scopeJson,
        anonymousAllowed: nextAnonymous ? 1 : 0,
        evidencePath: evidence,
        grantedAt: update.status === "approved" ? (update.grantedAt ?? todayLocal()) : perm.grantedAt,
        expiresAt: update.expiresAt ?? perm.expiresAt,
        revokedAt: update.status === "revoked" ? nowIso() : perm.revokedAt,
      })
      .where(eq(t.customerPermissions.id, permissionId))
      .run();
    audit(tx, actor, "permission_recorded", "customer_permission", permissionId, {
      status: update.status,
      scope: update.scope,
      anonymousAllowed: update.anonymousAllowed,
    });
  });
}

export interface PortfolioView {
  item: typeof t.portfolioItems.$inferSelect;
  permission: typeof t.customerPermissions.$inferSelect | null;
  rights: RightsCheck;
}

export function listPortfolio(db: Db): PortfolioView[] {
  const items = db.select().from(t.portfolioItems).orderBy(desc(t.portfolioItems.createdAt)).all();
  return items.map((item) => {
    const permission = item.permissionId
      ? (db.select().from(t.customerPermissions).where(eq(t.customerPermissions.id, item.permissionId)).get() ?? null)
      : null;
    return { item, permission, rights: checkPortfolioRights(db, item.id) };
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
  /** V3-H: 生成停止中はその理由(nullなら通常運転) */
  generationPause: GenerationPause | null;
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
    generationPause: getGenerationPause(db),
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
  /** この社員の成果物が含まれる承認待ち投稿(V3-I: 誰が何を待っているか) */
  awaitingPosts: { id: string; title: string }[];
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
    awaitingPosts: db
      .selectDistinct({ id: t.posts.id, title: t.posts.title })
      .from(t.posts)
      .innerJoin(t.artifacts, eq(t.artifacts.postId, t.posts.id))
      .innerJoin(t.tasks, eq(t.artifacts.taskId, t.tasks.id))
      .where(and(eq(t.posts.status, "awaiting_approval"), eq(t.tasks.assigneeId, employeeId)))
      .all(),
  };
}

// ==========================================================================
// V4-B: export_bundle と 投稿済み記録
// 公開経路は「QA合格 → 代表者承認 → export → 人間の手動投稿 → published記録」のみ。
// core/use-case層で再検査する(UI/CLIだけの判定にしない)。
// ==========================================================================

function latestQaPass(conn: DbConn, postId: string): boolean {
  const qa = conn.select().from(t.qaReviews).where(eq(t.qaReviews.postId, postId)).orderBy(desc(t.qaReviews.createdAt)).limit(1).get();
  return !!qa && qa.result === "pass";
}

function generatedPostsRoot(): string {
  return nodePath.join(workspaceRoot(), "05_generated-posts");
}

export interface ExportResult {
  postId: string;
  exportPath: string; // 論理相対パス(05_generated-posts/<dir>)
  files: string[];
  skipped: boolean;
}

/**
 * 承認済み投稿の書き出し(V4-B, AC-18/19)。owner専用。
 * 手順: 再検査(承認/整合性/最新QA/権利) → 一時DirへBundle生成 → atomic rename → DBトランザクション。
 * DB失敗時はこの呼び出しで作った完成フォルダを補償削除しapprovedのまま維持(既存フォルダは削除しない)。冪等。
 */
export function exportPost(db: Db, postId: string, actor: string): ExportResult {
  if (actor !== "owner") throw new Error("書き出しは代表者(owner)のみが行えます");

  const post = getPostOrThrow(db, postId);
  const root = generatedPostsRoot();

  // 冪等: 既に exported で export_path が実在すれば何もしない
  if (post.status === "exported" && post.exportPath) {
    const abs = nodePath.join(workspaceRoot(), post.exportPath.replace(/^data\/workspace\//, ""));
    if (existsSync(abs)) {
      return { postId, exportPath: post.exportPath, files: [], skipped: true };
    }
    // export_pathが失われている → doctorで検出。ここでは再書き出しを許可するため下へ進む
  } else if (post.status !== "approved") {
    throw new Error(`書き出しは承認済み(approved)の投稿のみ可能です(現在: ${post.status})`);
  }

  // 再検査(すべて通常コード)
  const integrity = assertPostContentIntegrity(db, postId);
  if (!latestQaPass(db, postId)) throw new Error("整合性エラー: 最新のQA結果が合格ではありません");
  assertPublicTextSafety(db, post, integrity.copy);
  assertPortfolioRightsForPost(db, post, integrity.spec);
  // V4.5公開停止ガード: 承認済みテンプレート版・fingerprint一致・design QA合格でなければ拒否
  assertExportableTemplate(db, postId);

  // 画像の絶対パス(投稿順)
  const imgRows = db
    .select({ id: t.artifacts.id, filePath: t.artifacts.filePath })
    .from(t.artifacts)
    .where(inArray(t.artifacts.id, integrity.imageArtifactIds))
    .all();
  const imageFilePaths = imgRows
    .filter((r) => r.filePath)
    .sort((a, b) => (a.filePath ?? "").localeCompare(b.filePath ?? ""))
    .map((r) => r.filePath!);
  if (imageFilePaths.length === 0) throw new Error("整合性エラー: 書き出す画像がありません");
  for (const p of imageFilePaths) {
    if (!existsSync(p)) throw new Error(`整合性エラー: 画像ファイルが存在しません(${p})`);
  }

  const sources = getLinkedSources(db, postId)
    .filter((s) => s.usable && s.verificationStatus === "confirmed")
    .map((s) => ({ publisher: s.publisher, title: s.title, publishedAt: s.publishedAt }));

  const bd = businessDate();
  const dirName = `${bd}_${postId}`;
  const exportDir = nodePath.join(root, dirName);
  const relPath = `data/workspace/05_generated-posts/${dirName}`;

  const c = integrity.copy;
  const data: BundleData = {
    postId,
    title: post.title,
    templateId: post.templateId,
    pillar: post.pillar,
    imageFilePaths,
    caption: { headline: c.headline, body: c.body, cta: c.cta, hashtags: c.hashtags },
    sources,
    rightsState: post.rightsState,
    exportedAt: nowIso(),
    businessDate: bd,
  };

  // 一時Dir(同一ボリューム)へ生成 → atomic rename
  const tmpDir = nodePath.join(root, `.export-tmp-${ulid()}`);
  let files: string[];
  try {
    files = writeBundleToDir(tmpDir, data);
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }

  // 書き出し先が既存なら上書きしない(既存フォルダは削除しない)
  if (existsSync(exportDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
    if (post.status === "exported") {
      return { postId, exportPath: relPath, files: [], skipped: true };
    }
    throw new Error(`書き出し先が既に存在します: ${relPath}。pnpm company doctor で確認してください`);
  }
  renameSync(tmpDir, exportDir);

  // DBトランザクション。失敗時は本呼び出しで作ったフォルダを補償削除
  try {
    db.transaction((tx) => {
      const fresh = getPostOrThrow(tx, postId);
      if (fresh.status === "approved") {
        setPostStatus(tx, fresh, "exported", { exportPath: relPath });
      } else if (fresh.status !== "exported") {
        throw new Error(`書き出し中に投稿状態が変わりました(現在: ${fresh.status})`);
      }
      audit(tx, actor, "post_exported", "post", postId, { exportPath: relPath, images: imageFilePaths.length });
    });
  } catch (dbErr) {
    rmSync(exportDir, { recursive: true, force: true });
    throw dbErr;
  }

  return { postId, exportPath: relPath, files, skipped: false };
}

export interface PublishRecordResult {
  postId: string;
  publishedAt: string;
  metricTaskIds: string[];
}

export type PublishMethod = "manual" | "meta_api";

/**
 * 投稿済み記録(V4-B, AC-20)。owner専用。exported の投稿のみ。
 * 手動公開またはV5公式API公開の完了記録。3日/7日後の実績入力タスクを各1件作る(JST・重複なし)。
 */
export function recordPublish(db: Db, postId: string, actor: string, publishMethod: PublishMethod = "manual"): PublishRecordResult {
  if (actor !== "owner") throw new Error("投稿済み記録は代表者(owner)のみが行えます");
  return db.transaction((tx) => {
    const post = getPostOrThrow(tx, postId);
    if (post.status !== "exported") {
      throw new Error(`「投稿済みにする」は書き出し済み(exported)の投稿のみ可能です(現在: ${post.status})`);
    }
    const publishedAt = nowIso();
    setPostStatus(tx, post, "published", { publishedAt, publishMethod });
    audit(tx, actor, "publish_recorded", "post", postId, { publishedAt, publishMethod });

    // 3日後・7日後の実績値入力タスク(湊)。runDateは対象日(JST)で冪等
    const bd = businessDate();
    const metricTaskIds: string[] = [];
    for (const win of [3, 7] as const) {
      const targetDate = addDays(bd, win);
      const task = createTaskIn(
        tx,
        {
          type: "report",
          title: `実績値入力(${win}日後): ${post.title}`.slice(0, 120),
          assigneeId: "emp_minato",
          postId,
          stepKey: `metric-d${win}`,
          priority: 4,
          input: { windowDays: win, kind: "post_metrics_reminder" },
        },
        targetDate,
        actor,
      );
      metricTaskIds.push(task.id);
    }
    return { postId, publishedAt, metricTaskIds };
  });
}

/**
 * V5公開直前ゲート。export時の検査を再実行し、権利取消・QA/テンプレート変更を公開直前にも検出する。
 * Metaアダプターはこの関数を通らない限り外部通信してはならない。
 */
export function assertPostReadyForExternalPublish(db: Db, postId: string): { exportPath: string; title: string } {
  const post = getPostOrThrow(db, postId);
  if (post.status !== "exported" || !post.exportPath) {
    throw new Error(`Instagram公開は書き出し済み(exported)の投稿のみ可能です(現在: ${post.status})`);
  }
  const integrity = assertPostContentIntegrity(db, postId);
  if (!latestQaPass(db, postId)) throw new Error("整合性エラー: 最新のQA結果が合格ではありません");
  assertPublicTextSafety(db, post, integrity.copy);
  assertPortfolioRightsForPost(db, post, integrity.spec);
  assertExportableTemplate(db, postId);

  const abs = nodePath.resolve(workspaceRoot(), post.exportPath.replace(/^data\/workspace\//, ""));
  const root = nodePath.resolve(workspaceRoot(), "05_generated-posts") + nodePath.sep;
  if (!abs.startsWith(root) || !existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error("書き出しフォルダが存在しないか、許可された公開フォルダ外です。再書き出ししてください");
  }
  return { exportPath: post.exportPath, title: post.title };
}

/** 実績値の記録(V4-C)。owner専用。NULL可・負数拒否・整数はスキーマで強制。既存(post+window)は上書き更新 */
export function addPostMetric(db: Db, input: import("../../core/schemas").PostMetricInput, actor: string): { id: string; updated: boolean } {
  if (actor !== "owner") throw new Error("実績値の入力は代表者(owner)のみが行えます");
  return db.transaction((tx) => {
    const post = getPostOrThrow(tx, input.postId);
    void post;
    const existing = tx
      .select()
      .from(t.postMetrics)
      .where(and(eq(t.postMetrics.postId, input.postId), eq(t.postMetrics.windowDays, input.windowDays)))
      .get();
    const values = {
      measuredAt: nowIso(),
      reach: input.reach ?? null,
      profileViews: input.profileViews ?? null,
      saves: input.saves ?? null,
      shares: input.shares ?? null,
      comments: input.comments ?? null,
      dmStarts: input.dmStarts ?? null,
      followerCount: input.followerCount ?? null,
      note: input.note?.trim() || null,
    };
    if (existing) {
      tx.update(t.postMetrics).set(values).where(eq(t.postMetrics.id, existing.id)).run();
      audit(tx, actor, "post_metric_recorded", "post", input.postId, { windowDays: input.windowDays, updated: true });
      return { id: existing.id, updated: true };
    }
    const id = ulid();
    tx.insert(t.postMetrics)
      .values({ id, postId: input.postId, windowDays: input.windowDays, createdAt: nowIso(), ...values })
      .run();
    audit(tx, actor, "post_metric_recorded", "post", input.postId, { windowDays: input.windowDays, updated: false });
    return { id, updated: false };
  });
}

/** 公開準備ビュー: approved(書き出し可)/exported(投稿済み記録可)/published の投稿 */
export interface PublishReadyItem {
  id: string;
  title: string;
  status: string;
  exportPath: string | null;
  publishedAt: string | null;
  imageArtifactIds: string[];
  integrityError: string | null;
  metrics: { windowDays: number; measuredAt: string; hasData: boolean }[];
}

export function listPublishReady(db: Db): PublishReadyItem[] {
  const posts = db
    .select()
    .from(t.posts)
    .where(inArray(t.posts.status, ["approved", "exported", "published", "measured"]))
    .orderBy(desc(t.posts.createdAt))
    .all();
  return posts.map((post): PublishReadyItem => {
    let integrityError: string | null = null;
    let imageArtifactIds: string[] = [];
    try {
      const r = assertPostContentIntegrity(db, post.id);
      imageArtifactIds = r.imageArtifactIds;
    } catch (e) {
      integrityError = e instanceof Error ? e.message : String(e);
    }
    const metrics = db
      .select()
      .from(t.postMetrics)
      .where(eq(t.postMetrics.postId, post.id))
      .all()
      .map((m) => ({
        windowDays: m.windowDays ?? 0,
        measuredAt: m.measuredAt,
        hasData: [m.reach, m.profileViews, m.saves, m.shares, m.comments, m.dmStarts, m.followerCount].some((v) => v !== null),
      }));
    return {
      id: post.id,
      title: post.title,
      status: post.status,
      exportPath: post.exportPath,
      publishedAt: post.publishedAt,
      imageArtifactIds,
      integrityError,
      metrics,
    };
  });
}

// ---------- V4-C: 週次会議の議事録保存 ----------
// オーケストレーターが weekly-review skill 経由で CLI から保存する。
// meeting_minutes 成果物(履歴はversionで保持)+ meetings行(kind+期間で最新を保持)。

export function saveMeeting(db: Db, input: unknown, actor: string): { meetingId: string; artifactId: string } {
  const minutes: MeetingMinutesArtifact = meetingMinutesArtifactSchema.parse(input);
  if (minutes.decisions.length > 0 && actor !== "owner") {
    throw new Error("会議の決定(decisions)は代表者(owner)が確認した場合だけ保存できます。AI社員はproposalsへ記録してください");
  }
  return db.transaction((tx) => {
    // 会議コンテナのタスク(常に新規。議事録は再保存で新versionになる)
    const created = createTaskIn(
      tx,
      {
        type: "meeting",
        title: `${minutes.meetingKind === "weekly" ? "週次" : "月次"}会議 ${minutes.periodStart}〜${minutes.periodEnd}`.slice(0, 120),
        assigneeId: "emp_aoi",
        stepKey: `meeting-${minutes.meetingKind}-${minutes.periodEnd}-${ulid().slice(-6)}`,
        priority: 5,
      },
      businessDate(),
      actor,
    );
    setTaskStatus(tx, created, "running", { startedAt: nowIso() });
    const running = getTaskOrThrow(tx, created.id);
    const artifactId = insertContentArtifactIn(tx, running, minutes, actor);
    completeTaskIn(tx, running, actor, { estOutputChars: JSON.stringify(minutes).length });

    // meetings行: 同一 kind+period_end は最新へ置換(スナップショット)
    const existing = tx
      .select()
      .from(t.meetings)
      .where(and(eq(t.meetings.kind, minutes.meetingKind), eq(t.meetings.periodEnd, minutes.periodEnd)))
      .get();
    const meetingId = existing?.id ?? ulid();
    const row = {
      kind: minutes.meetingKind,
      heldOn: minutes.heldOn,
      periodStart: minutes.periodStart,
      periodEnd: minutes.periodEnd,
      participantsJson: JSON.stringify(minutes.participants),
      agendaJson: JSON.stringify(minutes.agenda),
      decisionsJson: JSON.stringify(minutes.decisions),
      minutesArtifactId: artifactId,
      createdAt: nowIso(),
    };
    if (existing) {
      tx.update(t.meetings).set(row).where(eq(t.meetings.id, meetingId)).run();
    } else {
      tx.insert(t.meetings).values({ id: meetingId, ...row }).run();
    }
    audit(tx, actor, "meeting_saved", "meeting", meetingId, { kind: minutes.meetingKind, periodEnd: minutes.periodEnd });
    if (minutes.decisions.length > 0) {
      audit(tx, actor, "meeting_decisions_confirmed", "meeting", meetingId, { count: minutes.decisions.length });
    }
    return { meetingId, artifactId };
  });
}

// ---------- V4-D: 運用設定(owner専用) ----------

export function getOperationSettings(db: Db): OperationSettings {
  const saved = getSetting<Partial<OperationSettings>>(db, "operation_settings");
  const merged = { ...DEFAULT_OPERATION_SETTINGS, ...(saved ?? {}) };
  const parsed = operationSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...DEFAULT_OPERATION_SETTINGS };
}

export function updateOperationSettings(db: Db, input: unknown, actor: string): OperationSettings {
  if (actor !== "owner") throw new Error("運用設定の変更は代表者(owner)のみが行えます");
  const next = operationSettingsSchema.parse(input);
  db.transaction((tx) => {
    setSetting(tx, "operation_settings", next);
    audit(tx, actor, "setting_changed", "settings", "operation_settings", { ...next });
  });
  return next;
}

// ---------- V4.5: テンプレート版承認・レンダリング記録・公開停止ガード ----------

export type TemplateVersionRow = typeof t.templateVersions.$inferSelect;
export type PostRenderRow = typeof t.postRenders.$inferSelect;
export type TemplateDecision = "approved" | "rejected" | "revision_requested";

/** そのテンプレートの現行版番号(登録済みの最大値。未登録は1) */
export function currentTemplateVersion(db: Db, templateId: string): number {
  const row = db
    .select({ v: sql<number>`max(version)` })
    .from(t.templateVersions)
    .where(eq(t.templateVersions.templateId, templateId))
    .get();
  return row?.v ?? 1;
}

/** 現行版の版行を用意する(なければdraftを作成)。冪等。fingerprintは現行design-systemから決定的に算出 */
export function ensureTemplateVersion(db: Db, templateId: string, actor = "system"): TemplateVersionRow {
  const version = currentTemplateVersion(db, templateId);
  const existing = getTemplateVersion(db, templateId, version);
  if (existing) return existing;
  const family = TEMPLATES[templateId as keyof typeof TEMPLATES]?.family ?? templateId;
  const fingerprint = computeFingerprint(templateId, version);
  const id = ulid();
  db.transaction((tx) => {
    tx.insert(t.templateVersions).values({ id, templateId, family, version, status: "draft", fingerprint, createdAt: nowIso() }).run();
    audit(tx, actor, "template_version_registered", "template_version", id, { templateId, version, fingerprint });
  });
  return getTemplateVersion(db, templateId, version)!;
}

/** 指定版をdraftとして用意する(なければ作成)。既存v1を消さずv2を新設する用途。冪等 */
export function ensureTemplateVersionAt(db: Db, templateId: string, version: number, actor = "system"): TemplateVersionRow {
  const existing = getTemplateVersion(db, templateId, version);
  if (existing) return existing;
  const family = TEMPLATES[templateId as keyof typeof TEMPLATES]?.family ?? templateId;
  const fingerprint = computeFingerprint(templateId, version);
  const id = ulid();
  db.transaction((tx) => {
    tx.insert(t.templateVersions).values({ id, templateId, family, version, status: "draft", fingerprint, createdAt: nowIso() }).run();
    audit(tx, actor, "template_version_registered", "template_version", id, { templateId, version, fingerprint });
  });
  return getTemplateVersion(db, templateId, version)!;
}

/** 全テンプレートの現行版をdraftとして登録する(CLI/preview用。冪等) */
export function registerAllTemplateVersions(db: Db, actor = "system"): TemplateVersionRow[] {
  return (Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((id) => ensureTemplateVersion(db, id, actor));
}

/** 全テンプレートの指定版をdraftとして登録する(v2生成用。既存版は不変) */
export function registerAllTemplateVersionsAt(db: Db, version: number, actor = "system"): TemplateVersionRow[] {
  return (Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((id) => ensureTemplateVersionAt(db, id, version, actor));
}

export function getTemplateVersion(db: Db, templateId: string, version: number): TemplateVersionRow | undefined {
  return db
    .select()
    .from(t.templateVersions)
    .where(and(eq(t.templateVersions.templateId, templateId), eq(t.templateVersions.version, version)))
    .get();
}

export function listTemplateVersions(db: Db): TemplateVersionRow[] {
  return db.select().from(t.templateVersions).orderBy(asc(t.templateVersions.templateId), desc(t.templateVersions.version)).all();
}

/** 最新の承認済み版(templateIdごと)。無ければnull */
export function latestApprovedTemplateVersion(db: Db, templateId: string): TemplateVersionRow | null {
  return (
    db
      .select()
      .from(t.templateVersions)
      .where(and(eq(t.templateVersions.templateId, templateId), eq(t.templateVersions.status, "approved")))
      .orderBy(desc(t.templateVersions.version))
      .get() ?? null
  );
}

/** テンプレート版の承認/却下/修正依頼(owner専用)。自己承認は不可。audit記録 */
export function decideTemplateVersion(
  db: Db,
  input: { templateId: string; version: number; decision: TemplateDecision; note?: string },
  actor: string,
): TemplateVersionRow {
  if (actor !== "owner") throw new Error("テンプレート版の承認・却下は代表者(owner)のみが行えます");
  const row = getTemplateVersion(db, input.templateId, input.version);
  if (!row) throw new Error(`テンプレート版が見つかりません: ${input.templateId} v${input.version}`);
  // 却下・修正依頼は理由必須(audit_logへ保存)
  if ((input.decision === "rejected" || input.decision === "revision_requested") && !input.note?.trim()) {
    throw new Error("却下・修正依頼には理由(note)の入力が必要です");
  }
  // 承認は、全variantのpreview・content/mechanical/visual QA・fingerprint一致・権利が揃って初めて可能(core層で強制)
  if (input.decision === "approved") assertTemplateApprovable(db, input.templateId, input.version);
  db.transaction((tx) => {
    tx.update(t.templateVersions)
      .set({ status: input.decision, note: input.note ?? null, decidedAt: nowIso(), decidedBy: actor })
      .where(eq(t.templateVersions.id, row.id))
      .run();
    audit(tx, actor, "template_version_decided", "template_version", row.id, {
      templateId: input.templateId,
      version: input.version,
      decision: input.decision,
      fingerprint: row.fingerprint,
      note: input.note ?? null,
    });
  });
  return getTemplateVersion(db, input.templateId, input.version)!;
}

/** 投稿レンダリングの記録(使用版・variant・fingerprint・design QA結果)。最新が有効 */
export function recordPostRender(
  db: Db,
  input: {
    postId: string;
    specArtifactId: string;
    templateId: string;
    templateVersion: number;
    variant: string;
    fingerprint: string;
    designQa: DesignQaResult;
  },
  actor = "system",
): string {
  const id = ulid();
  db.transaction((tx) => {
    tx.insert(t.postRenders)
      .values({
        id,
        postId: input.postId,
        specArtifactId: input.specArtifactId,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        variant: input.variant,
        fingerprint: input.fingerprint,
        designQaResult: input.designQa.result,
        designQaJson: JSON.stringify(input.designQa),
        createdAt: nowIso(),
      })
      .run();
    audit(tx, actor, "post_rendered", "post", input.postId, {
      templateId: input.templateId,
      version: input.templateVersion,
      variant: input.variant,
      fingerprint: input.fingerprint,
      designQa: input.designQa.result,
    });
  });
  return id;
}

/** 投稿の最新レンダリング記録 */
export function latestPostRender(db: Db, postId: string): PostRenderRow | null {
  return (
    db.select().from(t.postRenders).where(eq(t.postRenders.postId, postId)).orderBy(desc(t.postRenders.createdAt)).get() ?? null
  );
}

/**
 * 公開停止ガード(V4.5 §2)。承認済みテンプレート版・fingerprint一致・design QA合格・現行承認版でなければ拒否する。
 * exportPost / UI / CLI / API の全経路がこれを通る(回避不能)。
 */
export function assertExportableTemplate(db: Db, postId: string): { templateId: string; version: number; fingerprint: string } {
  const render = latestPostRender(db, postId);
  if (!render) {
    throw new Error("テンプレート版の記録がありません。承認済みテンプレートで再レンダリングしてください(V4.5)");
  }
  if (render.designQaResult !== "pass") {
    throw new Error("デザインQAに合格していない画像は書き出せません(mechanical design QA fail)");
  }
  if (render.visualQaResult !== "pass") {
    throw new Error("紫苑の視覚QA(visual QA)に合格していない画像は書き出せません(未実施または fail)");
  }
  const tv = getTemplateVersion(db, render.templateId, render.templateVersion);
  if (!tv || tv.status !== "approved") {
    throw new Error("このテンプレート版は代表者に承認されていません。承認前のテンプレートでは公開できません");
  }
  if (render.fingerprint !== tv.fingerprint) {
    throw new Error("テンプレートのfingerprintが承認時と一致しません(旧版または改変の可能性)");
  }
  const latest = latestApprovedTemplateVersion(db, render.templateId);
  if (!latest || render.templateVersion !== latest.version) {
    throw new Error("承認済みの最新テンプレート版で再レンダリングされていません(旧版の画像は公開できません)");
  }
  return { templateId: render.templateId, version: render.templateVersion, fingerprint: render.fingerprint };
}

// ---------- V4.5 v2: variant単位QA・視覚QA・承認ゲート ----------

export type TemplateVariantQaRow = typeof t.templateVariantQa.$inferSelect;

/** テンプレート版のfingerprintが現行実装と一致するか(コード変更を検知) */
export function templateFingerprintMatchesCurrent(db: Db, templateId: string, version: number): boolean {
  const row = getTemplateVersion(db, templateId, version);
  if (!row) return false;
  return row.fingerprint === computeFingerprint(templateId, version);
}

/** preview生成時: variantのcontent/mechanical QA・プレビュー完了・fingerprint・権利・fixture種別をupsert(visual QAは別途) */
export function upsertTemplateVariantQa(
  db: Db,
  input: {
    templateId: string; version: number; variant: string; fingerprint: string;
    contentQaResult: "pass" | "fail"; mechanicalQaResult: "pass" | "fail";
    previewComplete: boolean; pageCount: number; fixtureKind: "fictional" | "real"; rights: string;
    layoutIds?: string[]; pageHashes?: string[];
  },
  actor = "system",
): void {
  const now = nowIso();
  const layoutIdsJson = input.layoutIds ? JSON.stringify(input.layoutIds) : null;
  const pageHashesJson = input.pageHashes ? JSON.stringify(input.pageHashes) : null;
  const existing = db
    .select()
    .from(t.templateVariantQa)
    .where(and(eq(t.templateVariantQa.templateId, input.templateId), eq(t.templateVariantQa.version, input.version), eq(t.templateVariantQa.variant, input.variant)))
    .get();
  db.transaction((tx) => {
    if (existing) {
      // fingerprintが変わったら視覚QAは無効化(再確認が必要)
      const visualStays = existing.fingerprint === input.fingerprint;
      tx.update(t.templateVariantQa)
        .set({
          fingerprint: input.fingerprint, contentQaResult: input.contentQaResult, mechanicalQaResult: input.mechanicalQaResult,
          previewComplete: input.previewComplete ? 1 : 0, pageCount: input.pageCount, fixtureKind: input.fixtureKind, rights: input.rights,
          layoutIdsJson: layoutIdsJson ?? existing.layoutIdsJson, pageHashesJson: pageHashesJson ?? existing.pageHashesJson,
          visualQaResult: visualStays ? existing.visualQaResult : null, visualQaJson: visualStays ? existing.visualQaJson : null,
          updatedAt: now,
        })
        .where(eq(t.templateVariantQa.id, existing.id))
        .run();
    } else {
      tx.insert(t.templateVariantQa).values({
        id: ulid(), templateId: input.templateId, version: input.version, variant: input.variant, fingerprint: input.fingerprint,
        contentQaResult: input.contentQaResult, mechanicalQaResult: input.mechanicalQaResult, visualQaResult: null, visualQaJson: null,
        previewComplete: input.previewComplete ? 1 : 0, pageCount: input.pageCount, fixtureKind: input.fixtureKind, rights: input.rights,
        layoutIdsJson, pageHashesJson, createdAt: now, updatedAt: now,
      }).run();
    }
    audit(tx, actor, "template_variant_qa_recorded", "template_version", `${input.templateId}:v${input.version}:${input.variant}`, {
      content: input.contentQaResult, mechanical: input.mechanicalQaResult, previewComplete: input.previewComplete,
    });
  });
}

/** 紫苑の視覚QAをvariantへ記録する。Zod検証しfail closed(critical>=1はpass不可はschemaで担保) */
export function recordTemplateVisualQa(
  db: Db,
  input: { templateId: string; version: number; variant: string; visualQa: unknown },
  actor = "shion",
): TemplateVariantQaRow {
  const parsed: VisualQaArtifact = visualQaArtifactSchema.parse(input.visualQa);
  const row = db
    .select()
    .from(t.templateVariantQa)
    .where(and(eq(t.templateVariantQa.templateId, input.templateId), eq(t.templateVariantQa.version, input.version), eq(t.templateVariantQa.variant, input.variant)))
    .get();
  if (!row) throw new Error(`variantのプレビューが未生成です: ${input.templateId} v${input.version} ${input.variant}(先に template-preview を実行)`);
  db.transaction((tx) => {
    tx.update(t.templateVariantQa)
      .set({ visualQaResult: parsed.result, visualQaJson: JSON.stringify(parsed), updatedAt: nowIso() })
      .where(eq(t.templateVariantQa.id, row.id))
      .run();
    audit(tx, actor, "template_visual_qa_recorded", "template_version", `${input.templateId}:v${input.version}:${input.variant}`, {
      result: parsed.result, critical: parsed.criticalIssues.length,
    });
  });
  return db.select().from(t.templateVariantQa).where(eq(t.templateVariantQa.id, row.id)).get()!;
}

export function listTemplateVariantQa(db: Db, templateId: string, version: number): TemplateVariantQaRow[] {
  return db
    .select()
    .from(t.templateVariantQa)
    .where(and(eq(t.templateVariantQa.templateId, templateId), eq(t.templateVariantQa.version, version)))
    .orderBy(asc(t.templateVariantQa.variant))
    .all();
}

/** 実運用のpost_renderへ視覚QAを紐付ける(Zod検証)。exportゲートが要求する */
export function attachPostRenderVisualQa(db: Db, postRenderId: string, visualQa: unknown, actor = "shion"): void {
  const parsed: VisualQaArtifact = visualQaArtifactSchema.parse(visualQa);
  const row = db.select().from(t.postRenders).where(eq(t.postRenders.id, postRenderId)).get();
  if (!row) throw new Error(`post_renderが見つかりません: ${postRenderId}`);
  db.transaction((tx) => {
    tx.update(t.postRenders).set({ visualQaResult: parsed.result, visualQaJson: JSON.stringify(parsed) }).where(eq(t.postRenders.id, postRenderId)).run();
    audit(tx, actor, "post_render_visual_qa", "post", row.postId, { result: parsed.result, critical: parsed.criticalIssues.length });
  });
}

export interface ApprovabilityFailure { variant: string; reason: string }

/** 承認可否をcore層で判定する。全variantのpreview・QA・fingerprint・権利が揃わなければ理由付きで拒否 */
export function templateApprovability(db: Db, templateId: string, version: number): { ok: boolean; failures: ApprovabilityFailure[] } {
  const failures: ApprovabilityFailure[] = [];
  const tpl = (TEMPLATES as Record<string, { variants: readonly string[] }>)[templateId];
  if (!tpl) return { ok: false, failures: [{ variant: "-", reason: `不明なテンプレート: ${templateId}` }] };
  if (!templateFingerprintMatchesCurrent(db, templateId, version)) {
    failures.push({ variant: "-", reason: "登録fingerprintが現行実装と一致しません(再生成が必要)" });
  }
  const qaRows = listTemplateVariantQa(db, templateId, version);
  const versionFp = getTemplateVersion(db, templateId, version)?.fingerprint;
  for (const variant of tpl.variants) {
    const qa = qaRows.find((r) => r.variant === variant);
    if (!qa) { failures.push({ variant, reason: "プレビュー/QA記録がありません(未確認variant)" }); continue; }
    if (!qa.previewComplete) failures.push({ variant, reason: "プレビューが未完成" });
    if (qa.fingerprint !== versionFp) failures.push({ variant, reason: "fingerprintが版と不一致" });
    if (qa.contentQaResult !== "pass") failures.push({ variant, reason: "content QA未合格" });
    if (qa.mechanicalQaResult !== "pass") failures.push({ variant, reason: "mechanical design QA未合格" });
    if (qa.visualQaResult !== "pass") failures.push({ variant, reason: "紫苑の視覚QA未合格(未実施またはfail)" });
    if (!qa.rights) failures.push({ variant, reason: "権利情報が未記録" });
  }
  // V4.5 v3: 承認候補の2variantは本文が実質的に異なる必要がある(表紙だけの差分を拒否)
  if (tpl.variants.length === 2) {
    const [va, vb] = tpl.variants.map((variant) => qaRows.find((r) => r.variant === variant));
    if (va?.layoutIdsJson && va.pageHashesJson && vb?.layoutIdsJson && vb.pageHashesJson) {
      const a = { layoutIds: JSON.parse(va.layoutIdsJson) as string[], pageHashes: JSON.parse(va.pageHashesJson) as string[] };
      const b = { layoutIds: JSON.parse(vb.layoutIdsJson) as string[], pageHashes: JSON.parse(vb.pageHashesJson) as string[] };
      const n = distinctInteriorPageCount(a, b);
      if (n < MIN_DISTINCT_INTERIOR_PAGES) {
        failures.push({ variant: `${tpl.variants[0]}↔${tpl.variants[1]}`, reason: `本文の差分が不足(01〜05で${n}ページのみ相違・最低${MIN_DISTINCT_INTERIOR_PAGES}必要)` });
      }
    } else {
      failures.push({ variant: "-", reason: "variant差分判定用のlayoutId/画像ハッシュが未記録" });
    }
  }
  return { ok: failures.length === 0, failures };
}

/** 承認ゲート。満たさなければ日本語の理由付きで throw(UI/API/CLIすべてが通る) */
export function assertTemplateApprovable(db: Db, templateId: string, version: number): void {
  const { ok, failures } = templateApprovability(db, templateId, version);
  if (!ok) {
    const detail = failures.map((f) => `${f.variant}: ${f.reason}`).join(" / ");
    throw new Error(`テンプレート版を承認できません(全variantのプレビュー・content/mechanical/visual QA・fingerprint・権利が必要): ${detail}`);
  }
}
