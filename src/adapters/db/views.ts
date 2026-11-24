/**
 * 読み取り専用ビュー(V3-E/F/G/J)。DBに存在する事実だけを集計する。
 * 進捗率は計算しない。推定値は「推定」と明示する。
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Db } from "./client";
import * as t from "./schema";
import {
  getSetting,
  getGenerationPause,
  assertPostContentIntegrity,
  getCompanyState,
  listApprovalQueue,
  currentTemplateVersion,
  getTemplateVersion,
  templateFingerprintMatchesCurrent,
  type GenerationPause,
  type CompanyStateView,
} from "./store";
import { loadLimits, brandStatus } from "../config";
import { workspaceRoot } from "../root";
import { listBackups } from "../backup/backup";
import { carouselSpecSchema, permissionScopeSchema, TEMPLATE_IDS, type ReportArtifact } from "../../core/schemas";
import { resolvePortfolioAssetFile, PortfolioMediaError } from "../render/portfolio-media";
import { todayLocal, businessDate } from "../../core/ids";
import { EMPLOYEES } from "../../core/org";
import { PERSONAS } from "../../core/personas";
import { findRepoRoot } from "../root";

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

  // V4.5: 登録済み実績画像の安全パス・hash再検査(読み取りのみ)
  const portfolioItems = db.select().from(t.portfolioItems).all();
  for (const item of portfolioItems) {
    if (item.assetsPath) {
      try {
        resolvePortfolioAssetFile(item.id, item.assetsPath);
      } catch (error) {
        findings.push({
          level: "error",
          subject: `portfolio ${item.id}`,
          message: `実績画像を安全に確認できません: ${error instanceof PortfolioMediaError ? error.message : String(error)}`,
          fix: "/portfolio からPNG/JPEG/WebPを再アップロードし、該当投稿を再レンダリングしてください",
        });
      }
    }
    const permission = item.permissionId
      ? db.select().from(t.customerPermissions).where(eq(t.customerPermissions.id, item.permissionId)).get()
      : undefined;
    let rawScope: unknown = {};
    try {
      rawScope = permission?.scopeJson ? JSON.parse(permission.scopeJson) : {};
    } catch {
      rawScope = {};
    }
    const scope = permissionScopeSchema.safeParse(rawScope);
    if (permission?.status === "approved" && scope.success && scope.data.screenshot && !item.assetsPath) {
      findings.push({
        level: "warn",
        subject: `portfolio ${item.id}`,
        message: "画面キャプチャは許可済みですが、実績画像が未登録です",
        fix: "/portfolio からHP画面キャプチャをアップロードしてください",
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

  // V4: 外部キー整合(DBレベル)
  const fkViolations = (db.all(sql`PRAGMA foreign_key_check`) as unknown[]).length;
  if (fkViolations > 0) {
    findings.push({
      level: "error",
      subject: "database",
      message: `外部キー違反が${fkViolations}件あります`,
      fix: "破損の可能性があります。pnpm company restore --from <日付> でバックアップから復元してください",
    });
  }

  // V4: exported投稿の書き出しフォルダ・meta.jsonの実在
  const exportedPosts = db.select().from(t.posts).where(inArray(t.posts.status, ["exported", "published", "measured"])).all();
  for (const p of exportedPosts) {
    if (!p.exportPath) {
      findings.push({ level: "warn", subject: `post ${p.id}`, message: `「${p.title}」は${p.status}ですが書き出し先が記録されていません`, fix: "pnpm company export --post <id> --actor owner で再書き出ししてください" });
      continue;
    }
    const abs = path.join(workspaceRoot(), p.exportPath.replace(/^data\/workspace\//, ""));
    if (!existsSync(path.join(abs, "meta.json"))) {
      findings.push({ level: "warn", subject: `post ${p.id}`, message: `書き出しフォルダが見つかりません: ${p.exportPath}`, fix: "pnpm company export --post <id> --actor owner で再書き出ししてください" });
    }
  }

  // V5: Instagram公開ジョブの整合。曖昧な外部結果は自動修復せず代表者確認を求める。
  const instagramJobs = db.select().from(t.instagramPublishJobs).all();
  for (const job of instagramJobs) {
    if (job.status === "needs_reconciliation" || job.status === "publishing") {
      findings.push({
        level: "error",
        subject: `instagram job ${job.id}`,
        message: "Instagram公開結果が未確定です。二重投稿防止のため自動再試行は停止されています",
        fix: "Instagramアプリで対象投稿の公開有無を確認し、実装者へジョブIDを伝えてください",
      });
    }
    if (["remote_published", "published"].includes(job.status) && !job.instagramMediaId) {
      findings.push({
        level: "error",
        subject: `instagram job ${job.id}`,
        message: "公開済み状態ですがInstagramメディアIDがありません",
        fix: "Instagram側と監査ログを照合し、バックアップを保全した上で修復してください",
      });
    }
    const serialized = `${job.errorMessage ?? ""} ${job.mediaUrlsJson}`;
    if (/EA[A-Za-z0-9]{80,}/.test(serialized)) {
      findings.push({
        level: "error",
        subject: `instagram job ${job.id}`,
        message: "公開ジョブにMetaアクセストークンらしき値が混入しています",
        fix: "公開処理を停止し、トークンを失効・再発行してから秘密情報を安全に除去してください",
      });
    }
  }

  // V4: meetings.minutes_artifact_id / reports.body_artifact_id の参照
  const orphanMeetings = db
    .select({ id: t.meetings.id, aid: t.meetings.minutesArtifactId })
    .from(t.meetings)
    .all()
    .filter((m) => m.aid && !db.select({ id: t.artifacts.id }).from(t.artifacts).where(eq(t.artifacts.id, m.aid!)).get());
  for (const m of orphanMeetings) {
    findings.push({ level: "warn", subject: `meeting ${m.id}`, message: "議事録成果物への参照が壊れています", fix: "pnpm company meeting-save で再保存してください" });
  }

  // V5.4: 公開画像URL記録の安全性(読み取りのみ)。HTTPS以外・localhost・トークン様クエリを検出する
  const mediaUploads = db.select().from(t.postMediaUploads).all();
  for (const upload of mediaUploads) {
    let bad: string | null = null;
    try {
      const u = new URL(upload.publicUrl);
      if (u.protocol !== "https:") bad = "HTTPSではありません";
      else if (["localhost", "127.0.0.1", "::1"].includes(u.hostname) || u.hostname.endsWith(".local")) bad = "非公開ホストです";
      else if (/(access_token|token|secret|authorization|signature|sig|key)=/i.test(u.search)) bad = "トークン様のクエリを含みます";
    } catch {
      bad = "URLとして不正です";
    }
    if (bad) {
      findings.push({
        level: "error",
        subject: `media upload ${upload.id}`,
        message: `公開画像URLが安全ではありません(${bad})`,
        fix: "pnpm company media-upload --post <id> --actor owner で正しい公開URLへ再準備してください",
      });
    }
  }

  // V5.4: schema_migrationsの適用連続性(欠番はDB状態の混在を示す)
  const appliedMigrationIds = (db.all(sql`select id from schema_migrations order by id`) as { id: number }[]).map((r) => r.id);
  for (let i = 1; i < appliedMigrationIds.length; i++) {
    if (appliedMigrationIds[i]! !== appliedMigrationIds[i - 1]! + 1) {
      findings.push({
        level: "warn",
        subject: "database",
        message: `schema_migrationsに欠番があります(${appliedMigrationIds[i - 1]} → ${appliedMigrationIds[i]})`,
        fix: "DBの由来を確認してください(バックアップからの復元や手動編集の痕跡の可能性)",
      });
    }
  }

  // V4: バックアップの有無・整合(read-only)
  try {
    const backups = listBackups();
    if (backups.length === 0) {
      findings.push({ level: "warn", subject: "backup", message: "バックアップがまだありません", fix: "pnpm company backup を実行(kickoff終了時にも自動作成されます)" });
    } else if (!backups[0]!.valid) {
      findings.push({ level: "error", subject: "backup", message: `最新バックアップ(${backups[0]!.date})のSHA-256が一致しません`, fix: "破損の可能性。別の世代から復元するか、pnpm company backup で作り直してください" });
    }
  } catch {
    // listBackups失敗は致命ではない
  }

  // 改善#6: テンプレート版のstale検査。承認後にコードが変更されfingerprintが乖離した版、
  // 決定されないまま残っているdraft版を検出する(公開停止ガード自体は別途強制されるが、
  // 代表者が気づく前にkickoffが止まる/止まらないの判断材料として明示する)。
  const STALE_DRAFT_DAYS = 3;
  for (const templateId of TEMPLATE_IDS) {
    const version = currentTemplateVersion(db, templateId);
    const row = getTemplateVersion(db, templateId, version);
    if (!row) continue;
    if (row.status === "approved" && !templateFingerprintMatchesCurrent(db, templateId, version)) {
      findings.push({
        level: "error",
        subject: `template ${templateId}`,
        message: `テンプレート「${templateId}」は承認済み(v${version})ですが、承認後にコードが変更されfingerprintが一致しません`,
        fix: "プレビューを再生成し、紫苑のテンプレート視覚QAを経て代表者に再承認を依頼してください",
      });
    } else if (row.status === "draft") {
      const ageMs = Date.now() - new Date(row.createdAt).getTime();
      if (ageMs > STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000) {
        findings.push({
          level: "warn",
          subject: `template ${templateId}`,
          message: `テンプレート「${templateId}」v${version}が${STALE_DRAFT_DAYS}日以上draftのまま未決定です(${row.createdAt}作成)`,
          fix: "プレビュー・QAを揃えて代表者の承認/却下を依頼するか、対応不要なら理由を記録してください",
        });
      }
    }
  }

  // 改善#7: QA「要確認」メモの集約。qa_reviews.notesは公開ブロックしない軽微指摘のため
  // 見落としやすい。承認待ち・下書き中の投稿について、代表者確認を求める文言を含む
  // 最新QAメモをdoctorへ集約表示する。
  const activePosts = db.select().from(t.posts).where(inArray(t.posts.status, ["awaiting_approval", "drafting", "qa_review"])).all();
  for (const p of activePosts) {
    const latestQa = db.select().from(t.qaReviews).where(eq(t.qaReviews.postId, p.id)).orderBy(desc(t.qaReviews.createdAt)).limit(1).get();
    if (!latestQa?.notesJson) continue;
    let notes: unknown[] = [];
    try {
      notes = JSON.parse(latestQa.notesJson);
    } catch {
      continue;
    }
    const flagged = notes.filter((n): n is string => typeof n === "string" && n.includes("確認") && (n.includes("要") || n.includes("代表者")));
    for (const note of flagged) {
      findings.push({
        level: "warn",
        subject: `post ${p.id}`,
        message: `「${p.title}」のQAメモに確認依頼があります: ${note.slice(0, 120)}`,
        fix: "/approvals で内容を確認し、問題なければそのまま承認、要修正なら修正依頼にしてください",
      });
    }
  }

  // 改善#8: V6改善ループの稼働状況。スナップショット未生成・長期間未生成は
  // ループが実質休眠していることを示す(エラーではなく運用上の気づきとしてwarn)。
  const DORMANT_DAYS = 14;
  const latestSnapshot = db.select().from(t.analysisSnapshots).orderBy(desc(t.analysisSnapshots.createdAt)).limit(1).get();
  if (!latestSnapshot) {
    findings.push({
      level: "warn",
      subject: "improvement-loop",
      message: "V6改善ループの分析スナップショットがまだ一度も生成されていません",
      fix: "pnpm company analytics-snapshot --window 7 を実行してください",
    });
  } else {
    const ageMs = Date.now() - new Date(latestSnapshot.createdAt).getTime();
    if (ageMs > DORMANT_DAYS * 24 * 60 * 60 * 1000) {
      findings.push({
        level: "warn",
        subject: "improvement-loop",
        message: `最新の分析スナップショットが${DORMANT_DAYS}日以上更新されていません(${latestSnapshot.createdAt})`,
        fix: "pnpm company analytics-snapshot --window 7 で再生成し、改善ループを継続するか代表者に確認してください",
      });
    }
  }
  const undecidedProposals = db
    .select({ id: t.improvementProposals.id })
    .from(t.improvementProposals)
    .all()
    .filter((row) => !db.select({ id: t.improvementDecisions.id }).from(t.improvementDecisions).where(eq(t.improvementDecisions.proposalId, row.id)).get());
  if (undecidedProposals.length > 0) {
    findings.push({
      level: "warn",
      subject: "improvement-loop",
      message: `代表者の判断が未記録の改善提案が${undecidedProposals.length}件あります`,
      fix: "pnpm company improvement-list で確認し、pnpm company improvement-decide で判断してください",
    });
  }

  // 改善#10: runs/ の保持方針(docs/13は「7日で自動削除」を推奨としているが、
  // 実際に削除するバッチ処理は存在しない。gitには入らない使い捨てデータのため、
  // doctorが古いものを検出し代表者/オーケストレーターに手動整理を促す(自動削除はしない)。
  const RUNS_RETENTION_DAYS = 7;
  try {
    const runsDir = path.join(findRepoRoot(), "runs");
    const dateDirs = existsSync(runsDir) ? readdirSync(runsDir).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)) : [];
    const cutoff = Date.now() - RUNS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const stale = dateDirs.filter((name) => new Date(`${name}T00:00:00Z`).getTime() < cutoff).sort();
    if (stale.length > 0) {
      findings.push({
        level: "warn",
        subject: "runs",
        message: `runs/ に保持期間(${RUNS_RETENTION_DAYS}日)を超えた古いディレクトリが${stale.length}件あります(${stale.slice(0, 3).join(", ")}${stale.length > 3 ? " 他" : ""})`,
        fix: "gitignore対象の使い捨てコンテキストです。内容を確認のうえ rm -rf runs/<日付> で手動削除してください(自動削除は行いません)",
      });
    }
  } catch {
    // runs/未作成・権限エラーは致命ではない
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

// ---------- V4-C: 週報/月報(通常コードで決定的集計。AIに数値計算させない) ----------

const PILLAR_NAME: Record<string, string> = {
  "1": "IT・AIニュース", "2": "HPの役割", "3": "HPで変わる", "4": "Web・ITトピック", "5": "制作実績", "6": "泉州課題解決",
};

/** 期間レポート(weekly/monthly)。JST業務日 [start,end] を集計。投稿10本未満は統計的断定をしない */
export function buildPeriodReport(db: Db, kind: "weekly" | "monthly", start: string, end: string): ReportArtifact {
  const inPeriod = sql`created_at >= ${start} AND created_at <= ${end}`;
  const postsCreated = db.select().from(t.posts).where(inPeriod).all();
  // 公開(published_at の JST日付が期間内)
  const publishedPosts = db
    .select({ id: t.posts.id })
    .from(t.posts)
    .where(sql`published_at IS NOT NULL AND date(published_at, '+9 hours') >= ${start} AND date(published_at, '+9 hours') <= ${end}`)
    .all();
  // 承認判断(decidedAt の JST日付が期間内)
  const decisions = db
    .select({ decision: t.approvals.decision, n: sql<number>`count(*)` })
    .from(t.approvals)
    .where(sql`date(decided_at, '+9 hours') >= ${start} AND date(decided_at, '+9 hours') <= ${end}`)
    .groupBy(t.approvals.decision)
    .all();
  const dcount = (d: string) => decisions.find((x) => x.decision === d)?.n ?? 0;
  const approved = dcount("approved");
  const rejected = dcount("rejected");
  const revision = dcount("revision_requested");
  const decidedTotal = approved + rejected + revision;
  // タスク失敗率(runDate 期間内)
  const taskAgg = db
    .select({ status: t.tasks.status, n: sql<number>`count(*)` })
    .from(t.tasks)
    .where(sql`run_date >= ${start} AND run_date <= ${end}`)
    .groupBy(t.tasks.status)
    .all();
  const tcount = (s: string) => taskAgg.find((x) => x.status === s)?.n ?? 0;
  const tasksTotal = taskAgg.reduce((a, x) => a + x.n, 0);
  const tasksFailed = tcount("failed");
  // 推定利用量(JST日付が期間内)
  const usage = db
    .select({ chars: sql<number>`coalesce(sum(est_output_chars),0)` })
    .from(t.usageRecords)
    .where(sql`date(ts, '+9 hours') >= ${start} AND date(ts, '+9 hours') <= ${end}`)
    .get();
  // 期間内に公開された投稿の入力済みSNS指標(未入力は集計から除外)
  const metricRows = db
    .select({
      postId: t.postMetrics.postId,
      windowDays: t.postMetrics.windowDays,
      measuredAt: t.postMetrics.measuredAt,
      reach: t.postMetrics.reach,
      saves: t.postMetrics.saves,
      profileViews: t.postMetrics.profileViews,
      dmStarts: t.postMetrics.dmStarts,
    })
    .from(t.postMetrics)
    .innerJoin(t.posts, eq(t.postMetrics.postId, t.posts.id))
    .where(sql`posts.published_at IS NOT NULL AND date(posts.published_at, '+9 hours') >= ${start} AND date(posts.published_at, '+9 hours') <= ${end}`)
    .orderBy(desc(t.postMetrics.windowDays), desc(t.postMetrics.measuredAt))
    .all();
  // 3日/7日は累積スナップショットなので加算しない。投稿ごとの最新(7日優先)だけを期間合計へ使う。
  const latestMetricByPost = new Map<string, (typeof metricRows)[number]>();
  for (const row of metricRows) {
    if (!latestMetricByPost.has(row.postId)) latestMetricByPost.set(row.postId, row);
  }
  const latestMetrics = [...latestMetricByPost.values()];
  const metrics = {
    reach: latestMetrics.reduce((n, m) => n + (m.reach ?? 0), 0),
    saves: latestMetrics.reduce((n, m) => n + (m.saves ?? 0), 0),
    profileViews: latestMetrics.reduce((n, m) => n + (m.profileViews ?? 0), 0),
    dmStarts: latestMetrics.reduce((n, m) => n + (m.dmStarts ?? 0), 0),
    entered: latestMetrics.length,
  };

  // 柱別
  const byPillar = new Map<string, number>();
  for (const p of postsCreated) byPillar.set(p.pillar, (byPillar.get(p.pillar) ?? 0) + 1);

  const approvalRate = decidedTotal > 0 ? Math.round((approved / decidedTotal) * 100) : null;
  const failRate = tasksTotal > 0 ? Math.round((tasksFailed / tasksTotal) * 100) : null;

  const lines: string[] = [];
  for (const [pillar, n] of [...byPillar.entries()].sort()) {
    lines.push(`柱「${PILLAR_NAME[pillar] ?? pillar}」: ${n}本`);
  }
  if (byPillar.size === 0) lines.push("この期間に作成した投稿はありません");
  lines.push(`承認: ${approved} / 却下: ${rejected} / 修正依頼: ${revision}`);
  lines.push(`推定モデル利用量: 約${(usage?.chars ?? 0).toLocaleString()}文字(推定値。Maxプラン枠内・API課金なし)`);
  if (metrics.entered > 0) {
    lines.push(`入力済みSNS指標(投稿ごとの最新スナップショット合計): リーチ ${metrics.reach} / 保存 ${metrics.saves} / プロフィール閲覧 ${metrics.profileViews} / DM開始 ${metrics.dmStarts}`);
  } else {
    lines.push("SNS実績値は未入力です(公開準備画面から3日後・7日後に入力してください)");
  }

  const totalPostsForStats = new Set([...postsCreated.map((p) => p.id), ...publishedPosts.map((p) => p.id)]).size;
  const dataNote =
    totalPostsForStats < 10
      ? "データ不足(投稿10本未満)のため、承認率・失敗率などは傾向の可能性として扱い、統計的な断定はしません。"
      : undefined;

  return {
    kind: "report",
    reportKind: kind,
    date: end,
    periodStart: start,
    periodEnd: end,
    stats: {
      postsCreated: postsCreated.length,
      published: publishedPosts.length,
      approved,
      rejected,
      revisions: revision,
      approvalRatePct: approvalRate ?? -1,
      failRatePct: failRate ?? -1,
      tasksTotal,
      tasksFailed,
      estOutputChars: usage?.chars ?? 0,
      snsMetricsEntered: metrics.entered,
    },
    lines,
    ownerActions:
      totalPostsForStats < 10
        ? ["投稿数を積み上げると分析の精度が上がります(週3本目標)。"]
        : approvalRate !== null && approvalRate < 60
          ? ["承認率が低めです。品質基準や企画方針を蓮・昊と見直してください。"]
          : ["現状の運用を継続してください。"],
    tomorrow: [],
    dataNote,
  };
}

// ---------- V4-C: 議事録一覧 ----------

export interface MeetingView {
  id: string;
  kind: string;
  heldOn: string;
  periodStart: string | null;
  periodEnd: string | null;
  participants: string[];
  decisions: string[];
  minutes: import("../../core/schemas").MeetingMinutesArtifact | null;
}

export function listMeetings(db: Db): MeetingView[] {
  const rows = db.select().from(t.meetings).orderBy(desc(t.meetings.heldOn)).all();
  return rows.map((m): MeetingView => {
    let minutes: import("../../core/schemas").MeetingMinutesArtifact | null = null;
    if (m.minutesArtifactId) {
      const art = db.select().from(t.artifacts).where(eq(t.artifacts.id, m.minutesArtifactId)).get();
      if (art?.contentJson) {
        try {
          minutes = JSON.parse(art.contentJson) as import("../../core/schemas").MeetingMinutesArtifact;
        } catch {
          minutes = null;
        }
      }
    }
    return {
      id: m.id,
      kind: m.kind,
      heldOn: m.heldOn,
      periodStart: m.periodStart,
      periodEnd: m.periodEnd,
      participants: m.participantsJson ? (JSON.parse(m.participantsJson) as string[]) : [],
      decisions: m.decisionsJson ? (JSON.parse(m.decisionsJson) as string[]) : [],
      minutes,
    };
  });
}

// ---------- V7: AI社員管理画面(/employees) ----------
// 「この画面を見ればAI社員のすべてがわかる」ための統合ビュー。
// プロフィール(personas.ts)+ 稼働状態(getCompanyState)+ 仕事の実績(DB集計)を1件にまとめる。

export interface EmployeeAdminItem {
  id: string;
  name: string;
  role: string;
  agentRef: string;
  departmentId: string;
  modelProfile: string;
  activeInMvp: boolean;
  spriteHue: number;
  display: CompanyStateView["employees"][number]["display"];
  currentTaskTitle: string | null;
  /** ペルソナ(personas.ts定義。UIで職務・権限・禁止事項を開示する) */
  persona: {
    personality: string;
    purpose: string;
    tools: string[];
    inputs: string[];
    outputs: string[];
    prohibitions: string[];
    onFailure: string;
  } | null;
  stats: {
    tasksDone: number;
    tasksFailed: number;
    tasksTotal: number;
    artifacts: number;
    estOutputChars: number;
    wallSeconds: number;
    lastActivityAt: string | null;
  };
  recentTasks: { id: string; title: string; type: string; status: string; runDate: string; finishedAt: string | null }[];
}

export interface EmployeesAdminView {
  departments: { id: string; name: string; status: string; unlockNote: string | null }[];
  employees: EmployeeAdminItem[];
}

export function employeesAdminView(db: Db, now: Date = new Date()): EmployeesAdminView {
  const state = getCompanyState(db, now);
  const agentRefById = new Map(EMPLOYEES.map((e) => [e.id, e.agentRef]));
  const personaByRef = new Map(PERSONAS.map((p) => [p.agentRef, p]));

  const employees = state.employees.map((v): EmployeeAdminItem => {
    const agentRef = agentRefById.get(v.id) ?? "";
    const persona = personaByRef.get(agentRef as (typeof PERSONAS)[number]["agentRef"]) ?? null;
    const counts = db
      .select({ status: t.tasks.status, n: sql<number>`count(*)` })
      .from(t.tasks)
      .where(eq(t.tasks.assigneeId, v.id))
      .groupBy(t.tasks.status)
      .all();
    const byStatus = new Map(counts.map((c) => [c.status, c.n]));
    const tasksTotal = counts.reduce((sum, c) => sum + c.n, 0);
    const artifacts =
      db
        .select({ n: sql<number>`count(*)` })
        .from(t.artifacts)
        .innerJoin(t.tasks, eq(t.artifacts.taskId, t.tasks.id))
        .where(eq(t.tasks.assigneeId, v.id))
        .get()?.n ?? 0;
    const usage = db
      .select({
        o: sql<number>`coalesce(sum(${t.usageRecords.estOutputChars}),0)`,
        w: sql<number>`coalesce(sum(${t.usageRecords.wallSeconds}),0)`,
      })
      .from(t.usageRecords)
      .innerJoin(t.tasks, eq(t.usageRecords.taskId, t.tasks.id))
      .where(eq(t.tasks.assigneeId, v.id))
      .get();
    const lastActivity = db
      .select({ ts: sql<string | null>`max(coalesce(${t.tasks.finishedAt}, ${t.tasks.startedAt}, ${t.tasks.createdAt}))` })
      .from(t.tasks)
      .where(eq(t.tasks.assigneeId, v.id))
      .get();
    const recentTasks = db
      .select({
        id: t.tasks.id,
        title: t.tasks.title,
        type: t.tasks.type,
        status: t.tasks.status,
        runDate: t.tasks.runDate,
        finishedAt: t.tasks.finishedAt,
      })
      .from(t.tasks)
      .where(eq(t.tasks.assigneeId, v.id))
      .orderBy(desc(t.tasks.createdAt))
      .limit(5)
      .all();
    return {
      id: v.id,
      name: v.name,
      role: v.role,
      agentRef,
      departmentId: v.departmentId,
      modelProfile: v.modelProfile,
      activeInMvp: v.activeInMvp,
      spriteHue: v.spriteHue,
      display: v.display,
      currentTaskTitle: v.currentTaskTitle,
      persona: persona
        ? {
            personality: persona.personality,
            purpose: persona.purpose,
            tools: persona.tools,
            inputs: persona.inputs,
            outputs: persona.outputs,
            prohibitions: persona.prohibitions,
            onFailure: persona.onFailure,
          }
        : null,
      stats: {
        tasksDone: byStatus.get("done") ?? 0,
        tasksFailed: byStatus.get("failed") ?? 0,
        tasksTotal,
        artifacts,
        estOutputChars: usage?.o ?? 0,
        wallSeconds: usage?.w ?? 0,
        lastActivityAt: lastActivity?.ts ?? null,
      },
      recentTasks,
    };
  });

  return { departments: state.departments, employees };
}
