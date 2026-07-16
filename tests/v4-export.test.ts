/**
 * V4-B: export_bundle + 投稿済み記録の統合テスト(AC-18/19/20)。
 * 実DB・実workspaceを使わない(BLOOM_WORKSPACE_PATH で一時領域へ隔離)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  ensureSeedOrg,
  createPost,
  createTask,
  startTask,
  submitArtifact,
  submitQa,
  decidePost,
  exportPost,
  recordPublish,
  addPostMetric,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { PLAN, COPY, QA_PASS, approveTemplate, passPostRenderVisualQa } from "./fixtures";

let dir: string;
let ws: string;
let opened: OpenedDb;
const DATE = "2026-07-14";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v4x-"));
  ws = mkdtempSync(path.join(tmpdir(), "bloom-v4ws-"));
  process.env.BLOOM_WORKSPACE_PATH = ws;
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.BLOOM_WORKSPACE_PATH;
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

/** 承認待ちまで進めた投稿を作る(render込み) */
async function makeApprovedPost(title = "書き出しテスト"): Promise<string> {
  const post = createPost(opened.db, { pillar: "6", format: "carousel", title }, "aoi");
  const planTask = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, planTask.id, "sora");
  submitArtifact(opened.db, planTask.id, PLAN, "sora");
  const copyTask = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copyTask.id, "kotoha");
  submitArtifact(opened.db, copyTask.id, COPY, "kotoha");
  await renderPost(opened.db, post.id, "system", { outDirBase: path.join(ws, "05_generated-posts") });
  const qaTask = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId: post.id, stepKey: "qa", priority: 4 }, DATE).task;
  startTask(opened.db, qaTask.id, "shion");
  submitQa(opened.db, qaTask.id, QA_PASS, "shion");
  decidePost(opened.db, post.id, "approved", null, "owner");
  // V4.5 v2: 公開停止ガードを満たす。post_renderに視覚QA、テンプレート版は全variantQAを揃えて承認
  passPostRenderVisualQa(opened.db, post.id);
  approveTemplate(opened.db, "tpl-howto");
  return post.id;
}

describe("V4-B: export_bundle", () => {
  it("owner以外は書き出しできない", async () => {
    const id = await makeApprovedPost();
    expect(() => exportPost(opened.db, id, "aoi")).toThrow(/代表者/);
  }, 60_000);

  it("未承認(drafting)投稿の書き出しは拒否される", () => {
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "未承認" }, "aoi");
    expect(() => exportPost(opened.db, post.id, "owner")).toThrow(/承認済み/);
  });

  it("成功: bundle生成 + approved→exported + export_path + audit post_exported", async () => {
    const id = await makeApprovedPost();
    const r = exportPost(opened.db, id, "owner");
    expect(r.skipped).toBe(false);
    expect(r.files).toEqual(expect.arrayContaining(["caption.txt", "checklist.md", "meta.json"]));
    // ファイルが実在
    const absDir = path.join(ws, r.exportPath.replace(/^data\/workspace\//, ""));
    expect(existsSync(path.join(absDir, "01.png"))).toBe(true);
    expect(existsSync(path.join(absDir, "caption.txt"))).toBe(true);
    const meta = JSON.parse(readFileSync(path.join(absDir, "meta.json"), "utf8")) as { postId: string; schemaVersion: string };
    expect(meta.postId).toBe(id);
    // 状態・監査
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, id)).get()!;
    expect(post.status).toBe("exported");
    expect(post.exportPath).toBe(r.exportPath);
    const audit = opened.db.select().from(t.auditLog).where(and(eq(t.auditLog.subjectId, id), eq(t.auditLog.action, "post_exported"))).all();
    expect(audit).toHaveLength(1);
  }, 60_000);

  it("再実行は冪等(skipped=true・監査重複なし)", async () => {
    const id = await makeApprovedPost();
    exportPost(opened.db, id, "owner");
    const r2 = exportPost(opened.db, id, "owner");
    expect(r2.skipped).toBe(true);
    const audit = opened.db.select().from(t.auditLog).where(and(eq(t.auditLog.subjectId, id), eq(t.auditLog.action, "post_exported"))).all();
    expect(audit).toHaveLength(1);
  }, 60_000);

  it("画像ファイル欠損時は書き出し拒否", async () => {
    const id = await makeApprovedPost();
    // 生成済みPNGを削除して整合性を壊す
    rmSync(path.join(ws, "05_generated-posts"), { recursive: true, force: true });
    expect(() => exportPost(opened.db, id, "owner")).toThrow(/画像ファイルが存在しません|画像がありません/);
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, id)).get()!.status).toBe("approved");
  }, 60_000);

  it("DBトランザクション失敗時はフォルダを補償削除しapprovedのまま(部分適用なし)", async () => {
    const id = await makeApprovedPost();
    // audit_log挿入を強制失敗させる(rename後のDB書き込みで失敗)
    opened.sqlite.exec("CREATE TRIGGER v4boom BEFORE INSERT ON audit_log WHEN NEW.action = 'post_exported' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(() => exportPost(opened.db, id, "owner")).toThrow(/boom/);
    opened.sqlite.exec("DROP TRIGGER v4boom;");
    // 投稿はapprovedのまま、フォルダは補償削除
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, id)).get()!.status).toBe("approved");
    // export bundle は <businessDate>_<postId>。render出力ディレクトリ(<postId>)は残ってよい
    const gen = path.join(ws, "05_generated-posts");
    const bundles = existsSync(gen) ? readdirSync(gen).filter((d) => /^\d{4}-\d{2}-\d{2}_/.test(d) && d.includes(id)) : [];
    expect(bundles).toHaveLength(0);
    // 一時ディレクトリも残っていない
    const tmps = existsSync(gen) ? readdirSync(gen).filter((d) => d.startsWith(".export-tmp")) : [];
    expect(tmps).toHaveLength(0);
  }, 60_000);
});

describe("V4-B: 投稿済み記録", () => {
  it("exported以外はpublished記録できない", async () => {
    const id = await makeApprovedPost();
    expect(() => recordPublish(opened.db, id, "owner")).toThrow(/書き出し済み/);
  }, 60_000);

  it("owner以外は記録できない", async () => {
    const id = await makeApprovedPost();
    exportPost(opened.db, id, "owner");
    expect(() => recordPublish(opened.db, id, "aoi")).toThrow(/代表者/);
  }, 60_000);

  it("成功: published + publish_method=manual + audit + 3日/7日タスク(重複なし)", async () => {
    const id = await makeApprovedPost();
    exportPost(opened.db, id, "owner");
    const r = recordPublish(opened.db, id, "owner");
    expect(r.metricTaskIds).toHaveLength(2);
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, id)).get()!;
    expect(post.status).toBe("published");
    expect(post.publishMethod).toBe("manual");
    expect(post.publishedAt).toBeTruthy();
    const audit = opened.db.select().from(t.auditLog).where(and(eq(t.auditLog.subjectId, id), eq(t.auditLog.action, "publish_recorded"))).all();
    expect(audit).toHaveLength(1);
    // 3日/7日の異なるstepKeyタスク
    const metricTasks = opened.db.select().from(t.tasks).where(and(eq(t.tasks.postId, id), eq(t.tasks.assigneeId, "emp_minato"))).all();
    expect(metricTasks).toHaveLength(2);
    expect(new Set(metricTasks.map((x) => x.idempotencyKey)).size).toBe(2);
  }, 60_000);
});

describe("V4-C: post_metrics 入力", () => {
  async function publishedPost(): Promise<string> {
    const id = await makeApprovedPost();
    exportPost(opened.db, id, "owner");
    recordPublish(opened.db, id, "owner");
    return id;
  }

  it("未入力はNULLのまま(0/推定で埋めない)", async () => {
    const id = await publishedPost();
    addPostMetric(opened.db, { postId: id, windowDays: 3, reach: 300 }, "owner");
    const m = opened.db.select().from(t.postMetrics).where(eq(t.postMetrics.postId, id)).get()!;
    expect(m.reach).toBe(300);
    expect(m.saves).toBeNull();
    expect(m.followerCount).toBeNull();
  }, 60_000);

  it("負数はスキーマで拒否される", async () => {
    const id = await publishedPost();
    const { postMetricInputSchema } = await import("@core/schemas");
    expect(postMetricInputSchema.safeParse({ postId: id, windowDays: 3, reach: -5 }).success).toBe(false);
  }, 60_000);

  it("同一(post, window)の再入力は更新(重複行を作らない)、owner以外は拒否", async () => {
    const id = await publishedPost();
    addPostMetric(opened.db, { postId: id, windowDays: 7, reach: 100 }, "owner");
    const r = addPostMetric(opened.db, { postId: id, windowDays: 7, reach: 250 }, "owner");
    expect(r.updated).toBe(true);
    const rows = opened.db.select().from(t.postMetrics).where(and(eq(t.postMetrics.postId, id), eq(t.postMetrics.windowDays, 7))).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reach).toBe(250);
    expect(() => addPostMetric(opened.db, { postId: id, windowDays: 3, reach: 1 }, "aoi")).toThrow(/代表者/);
  }, 60_000);
});
