/**
 * 読み取り専用ビュー(V3-E/F/G/J)。DBに存在する事実だけを集計する。
 * 進捗率は計算しない。推定値は「推定」と明示する。
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import type { Db } from "./client";
import * as t from "./schema";
import {
  getSetting,
  getGenerationPause,
  assertPostContentIntegrity,
  getCompanyState,
  listApprovalQueue,
  type GenerationPause,
  type CompanyStateView,
} from "./store";
import { loadLimits, brandStatus } from "../config";
import { carouselSpecSchema, type ReportArtifact } from "../../core/schemas";
import { todayLocal, businessDate } from "../../core/ids";
import { EMPLOYEES } from "../../core/org";

// ---------- S-04 投稿パイプライン ----------

export interface PipelineItem {
  id: string;
  title: string;
  status: string;
  rightsState: string;
  pillar: string;
  templateId: string;
  plannedDate: string | null;
  latestTask: { title: string; status: string; assigneeName: string } | null;
  latestArtifactKind: string | null;
  qaResult: string | null;
  hasError: boolean;
}

export interface PipelineView {
  counts: Record<string, number>;
  blockedRightsCount: number;
  items: PipelineItem[];
  generationPause: GenerationPause | null;
}

export function pipelineView(db: Db): PipelineView {
  const posts = db.select().from(t.posts).orderBy(desc(t.posts.plannedDate)).all();
  const empName = new Map(EMPLOYEES.map((e) => [e.id, e.name]));
  const counts: Record<string, number> = {};
  let blockedRightsCount = 0;
  const items = posts.map((post): PipelineItem => {
    counts[post.status] = (counts[post.status] ?? 0) + 1;
    if (post.rightsState === "blocked_rights") blockedRightsCount++;
    const latestTask = db
      .select()
      .from(t.tasks)
      .where(eq(t.tasks.postId, post.id))
      .orderBy(desc(t.tasks.createdAt))
      .limit(1)
      .get();
    const latestArtifact = db
      .select({ kind: t.artifacts.kind })
      .from(t.artifacts)
      .where(eq(t.artifacts.postId, post.id))
      .orderBy(desc(t.artifacts.createdAt))
      .limit(1)
      .get();
    const qa = db
      .select({ result: t.qaReviews.result })
      .from(t.qaReviews)
      .where(eq(t.qaReviews.postId, post.id))
      .orderBy(desc(t.qaReviews.createdAt))
      .limit(1)
      .get();
    const failedTask = db
      .select({ n: sql<number>`count(*)` })
      .from(t.tasks)
      .where(and(eq(t.tasks.postId, post.id), eq(t.tasks.status, "failed")))
      .get();
    return {
      id: post.id,
      title: post.title,
      status: post.status,
      rightsState: post.rightsState,
      pillar: post.pillar,
      templateId: post.templateId,
      plannedDate: post.plannedDate,
      latestTask: latestTask
        ? { title: latestTask.title, status: latestTask.status, assigneeName: empName.get(latestTask.assigneeId) ?? latestTask.assigneeId }
        : null,
      latestArtifactKind: latestArtifact?.kind ?? null,
      qaResult: qa?.result ?? null,
      hasError: (failedTask?.n ?? 0) > 0,
    };
  });
  return { counts, blockedRightsCount, items, generationPause: getGenerationPause(db) };
}

// ---------- S-05 投稿カレンダー ----------

export interface CalendarPost {
  id: string;
  title: string;
  status: string;
  rightsState: string;
  pillar: string;
  plannedDate: string;
}

export interface CalendarView {
  month: string; // YYYY-MM
  posts: CalendarPost[];
  dailyCap: number;
  weeklyTarget: number; // 週3本(docs/03)
}

export function calendarView(db: Db, month: string): CalendarView {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("monthはYYYY-MM形式で指定してください");
  const limits = loadLimits();
  const posts = db
    .select()
    .from(t.posts)
    .where(sql`planned_date LIKE ${month + "-%"}`)
    .orderBy(asc(t.posts.plannedDate))
    .all();
  return {
    month,
    posts: posts.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      rightsState: p.rightsState,
      pillar: p.pillar,
      plannedDate: p.plannedDate!,
    })),
    dailyCap: limits.daily.max_generated_posts,
    weeklyTarget: 3,
  };
}

// ---------- V3-G 日報(通常コード集計。AIは使わない) ----------

export function buildDailyReport(db: Db, date: string = todayLocal()): ReportArtifact {
  const postsToday = db.select().from(t.posts).where(eq(t.posts.createdAt, date)).all();
  const tasksToday = db.select().from(t.tasks).where(eq(t.tasks.runDate, date)).all();
  const done = tasksToday.filter((x) => x.status === "done");
  const failed = tasksToday.filter((x) => x.status === "failed");
  const awaiting = db.select().from(t.posts).where(eq(t.posts.status, "awaiting_approval")).all();
  const blocked = db.select().from(t.posts).where(eq(t.posts.rightsState, "blocked_rights")).all();
  const usage = db
    .select({ chars: sql<number>`coalesce(sum(est_output_chars),0)`, records: sql<number>`count(*)` })
    .from(t.usageRecords)
    .where(sql`substr(ts, 1, 10) = ${date}`)
    .get();
  const heavyToday = db
    .select({ n: sql<number>`count(*)` })
    .from(t.auditLog)
    .where(and(eq(t.auditLog.action, "heavy_escalation"), sql`substr(ts, 1, 10) = ${date}`))
    .get();
  const launchesToday = db
    .select({ n: sql<number>`count(*)` })
    .from(t.taskEvents)
    .where(and(eq(t.taskEvents.type, "started"), sql`substr(ts, 1, 10) = ${date}`))
    .get();
  const pause = getGenerationPause(db);
  const brand = brandStatus();

  const empName = new Map(EMPLOYEES.map((e) => [e.id, e.name]));
  const perEmployee = new Map<string, { done: number; failed: number }>();
  for (const task of tasksToday) {
    const rec = perEmployee.get(task.assigneeId) ?? { done: 0, failed: 0 };
    if (task.status === "done") rec.done++;
    if (task.status === "failed") rec.failed++;
    perEmployee.set(task.assigneeId, rec);
  }

  const lines: string[] = [];
  for (const post of postsToday) {
    lines.push(`投稿「${post.title}」: 現在 ${post.status}${post.rightsState === "blocked_rights" ? "(権利確認待ち)" : ""}`);
  }
  if (postsToday.length === 0) lines.push("本日作成した投稿はありません");
  for (const [empId, rec] of perEmployee) {
    lines.push(`${empName.get(empId) ?? empId}: 完了${rec.done}件 / 失敗${rec.failed}件`);
  }
  for (const task of failed) {
    lines.push(`失敗: ${task.title} — ${task.error ?? "理由未記録"}`);
  }
  lines.push(`推定モデル利用量: 約${(usage?.chars ?? 0).toLocaleString()}文字(推定値。Maxプラン枠内・API課金なし)`);
  if (pause) lines.push(`⚠ 新規生成は停止中: ${pause.reason}(${pause.pausedAt})`);
  if (brand.placeholder) lines.push("ブランドカラーはプレースホルダーで動作中(config/brand-tokens.json 未差し替え)");

  const ownerActions: string[] = [];
  if (awaiting.length > 0) ownerActions.push(`承認キューの確認(${awaiting.length}件): http://localhost:3000/approvals`);
  if (blocked.length > 0) ownerActions.push(`権利確認待ちが${blocked.length}件あります。実績画面で公開許可を記録してください`);
  if (pause) ownerActions.push("生成停止中です。状況を確認のうえダッシュボードから再開してください");
  if (failed.length > 0) ownerActions.push(`失敗タスクが${failed.length}件あります(詳細パネルから再開可能)`);
  if (ownerActions.length === 0) ownerActions.push("本日必要な代表者作業はありません");

  const tomorrow: string[] = [];
  if (awaiting.length >= 3) tomorrow.push("承認待ちが多いため、明日は生成を控えて承認処理を優先");
  else tomorrow.push("通常運用(新規投稿1本の企画→制作→QA)");
  if (blocked.length > 0) tomorrow.push("権利確認が取れた実績投稿の再QA");

  return {
    kind: "report",
    reportKind: "daily",
    date,
    stats: {
      postsCreated: postsToday.length,
      tasksDone: done.length,
      tasksFailed: failed.length,
      awaitingApproval: awaiting.length,
      blockedRights: blocked.length,
      estOutputChars: usage?.chars ?? 0,
      usageRecords: usage?.records ?? 0,
      heavyEscalations: heavyToday?.n ?? 0,
      agentLaunches: launchesToday?.n ?? 0,
    },
    lines,
    ownerActions,
    tomorrow,
  };
}

// ---------- V3-J doctor(読み取り検査。自動書き換えはしない) ----------

export interface DoctorFinding {
  level: "warn" | "error";
  subject: string;
  message: string;
  fix: string;
}

export function doctorScan(db: Db): DoctorFinding[] {
  const findings: DoctorFinding[] = [];

  // 旧形式・不正なcarousel_spec(最新版のみ対象。旧版の残存は正常)
  const posts = db.select().from(t.posts).all();
  for (const post of posts) {
    const latestSpec = db
      .select()
      .from(t.artifacts)
      .where(and(eq(t.artifacts.postId, post.id), eq(t.artifacts.kind, "carousel_spec")))
      .orderBy(desc(t.artifacts.version))
      .limit(1)
      .get();
    if (latestSpec?.contentJson) {
      const parsed = carouselSpecSchema.safeParse(JSON.parse(latestSpec.contentJson));
      if (!parsed.success) {
        findings.push({
          level: "error",
          subject: `post ${post.id}`,
          message: `「${post.title}」の最新カルーセル情報が旧形式です(sourceCopyArtifactId欠落等)`,
          fix: `pnpm company render --post ${post.id} で再レンダリングしてください`,
        });
      }
    }
    if (post.status === "awaiting_approval") {
      try {
        assertPostContentIntegrity(db, post.id);
      } catch (e) {
        findings.push({
          level: "error",
          subject: `post ${post.id}`,
          message: `承認待ち「${post.title}」が承認できない状態です: ${e instanceof Error ? e.message : String(e)}`,
          fix: `pnpm company render --post ${post.id} を実行後、再QAしてください`,
        });
      }
    }
  }

  // 画像ファイルの実在(承認待ち以外も最新画像を確認)
  const images = db.select().from(t.artifacts).where(eq(t.artifacts.kind, "image")).all();
  for (const img of images) {
    if (img.filePath && !existsSync(img.filePath)) {
      findings.push({
        level: "warn",
        subject: `artifact ${img.id}`,
        message: `画像ファイルが見つかりません: ${img.filePath}`,
        fix: "バックアップからの復元、または該当投稿の再レンダリングが必要です",
      });
    }
  }

  const pause = getGenerationPause(db);
  if (pause) {
    findings.push({
      level: "warn",
      subject: "generation",
      message: `新規生成が停止中です: ${pause.reason}`,
      fix: "ダッシュボード上部のバナーから代表者が再開できます",
    });
  }

  const brand = brandStatus();
  if (brand.placeholder || !brand.logoPresent) {
    findings.push({
      level: "warn",
      subject: "brand",
      message: `ブランド素材が未整備です(トークン: ${brand.placeholder ? "プレースホルダー" : "設定済み"} / ロゴ: ${brand.logoPresent ? "あり" : "なし"})`,
      fix: "data/workspace/01_brand/ にロゴ(logo.png|svg)を配置し、config/brand-tokens.json を正式値に更新してください(V3-K)",
    });
  }

  const demoMode = getSetting<boolean>(db, "demo_mode");
  if (demoMode) {
    findings.push({ level: "warn", subject: "demo", message: "デモモードで動作中です", fix: "実運用は pnpm company init" });
  }

  return findings;
}

// ---------- ホーム(オフィス)ダッシュボードの集約ビュー ----------
// DBの事実だけを集約。データ源のないKPI(問い合わせ数)は null=未取得 とする(0と混同しない)。

const WORKING_STATES = new Set(["researching", "creating", "meeting", "qa"]);

const TASK_TYPE_LABEL: Record<string, string> = {
  plan_posts: "投稿企画",
  write_copy: "コピー作成",
  design: "デザイン",
  render: "カルーセル生成",
  qa: "品質チェック",
  research: "リサーチ",
  report: "日報",
  meeting: "会議",
  ingest_portfolio: "実績取込",
};

export interface CurrentJob {
  employeeId: string;
  name: string;
  role: string;
  state: string;
  taskTitle: string | null;
  startedAt: string | null;
}

export interface ApprovalMini {
  postId: string;
  title: string;
  employeeName: string | null;
  format: string;
  imageArtifactIds: string[];
  ageMinutes: number | null;
}

export interface TodayResult {
  label: string;
  count: number;
}

export interface HomeView {
  state: CompanyStateView;
  kpi: {
    postsToday: number;
    awaitingApproval: number;
    activeEmployees: number;
    monthlyInquiries: number | null; // 未取得(Instagram DM連携は第2段階でデータ源なし)
  };
  currentJobs: CurrentJob[];
  approvals: ApprovalMini[];
  todayResults: TodayResult[];
  today: string;
}

export function homeView(db: Db, now: Date = new Date()): HomeView {
  const state = getCompanyState(db, now);
  const today = businessDate(now);
  const empById = new Map(state.employees.map((e) => [e.id, e]));

  // 現在の仕事: 稼働中の社員 + running中のタスク開始時刻(経過時間はUI側で算出)
  const currentJobs: CurrentJob[] = state.employees
    .filter((e) => WORKING_STATES.has(e.display.state))
    .map((e) => {
      let startedAt: string | null = null;
      if (e.display.currentTaskId) {
        const task = db.select({ startedAt: t.tasks.startedAt }).from(t.tasks).where(eq(t.tasks.id, e.display.currentTaskId)).get();
        startedAt = task?.startedAt ?? null;
      }
      return { employeeId: e.id, name: e.name, role: e.role, state: e.display.state, taskTitle: e.currentTaskTitle, startedAt };
    });

  // 承認待ち(ミニ): 上位5件。作成に関わった社員名・画像・経過分
  const queue = listApprovalQueue(db).slice(0, 5);
  const approvals: ApprovalMini[] = queue.map((item) => {
    const contributor = db
      .select({ assigneeId: t.tasks.assigneeId })
      .from(t.artifacts)
      .innerJoin(t.tasks, eq(t.artifacts.taskId, t.tasks.id))
      .where(eq(t.artifacts.postId, item.post.id))
      .orderBy(asc(t.artifacts.createdAt))
      .get();
    const empName = contributor ? (empById.get(contributor.assigneeId)?.name ?? null) : null;
    const created = db
      .select({ createdAt: t.artifacts.createdAt })
      .from(t.artifacts)
      .where(eq(t.artifacts.postId, item.post.id))
      .orderBy(desc(t.artifacts.createdAt))
      .get();
    const ageMinutes = created?.createdAt ? Math.max(0, Math.round((now.getTime() - new Date(created.createdAt).getTime()) / 60000)) : null;
    return {
      postId: item.post.id,
      title: item.post.title,
      employeeName: empName,
      format: item.post.format,
      imageArtifactIds: item.imageArtifactIds,
      ageMinutes,
    };
  });

  // 今日の成果: 本日(JST業務日)に完了したタスクを種別ごとに集計(DBの事実)
  const doneToday = db
    .select({ type: t.tasks.type, n: sql<number>`count(*)` })
    .from(t.tasks)
    .where(and(eq(t.tasks.status, "done"), eq(t.tasks.runDate, today)))
    .groupBy(t.tasks.type)
    .all();
  const todayResults: TodayResult[] = doneToday
    .filter((r) => r.n > 0)
    .map((r) => ({ label: TASK_TYPE_LABEL[r.type] ?? r.type, count: r.n }));

  const postsToday = db
    .select({ n: sql<number>`count(*)` })
    .from(t.posts)
    .where(eq(t.posts.createdAt, today))
    .get();

  return {
    state,
    today,
    kpi: {
      postsToday: postsToday?.n ?? 0,
      awaitingApproval: state.counts.awaitingApproval,
      activeEmployees: state.employees.filter((e) => WORKING_STATES.has(e.display.state)).length,
      monthlyInquiries: null, // データ源なし=未取得
    },
    currentJobs,
    approvals,
    todayResults,
  };
}
