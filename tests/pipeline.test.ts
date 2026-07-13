/**
 * V2: 投稿ライフサイクル(企画→コピー→レンダリング→QA→承認/却下/修正依頼)の統合テスト。
 * AC-15(QA未合格は承認キューに入らない)/ AC-16(approvals+audit記録)/ AC-17(修正タスク+版+1)
 * P1指摘2対応後: QA passにはレンダリング済み画像(最新copy由来)が必須。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
  listApprovalQueue,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { PLAN, COPY, QA_PASS } from "./fixtures";

let dir: string;
let imgDir: string;
let opened: OpenedDb;
const DATE = "2026-07-13";

function setupPipeline(): { postId: string; copyTaskId: string } {
  const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "テスト投稿" }, "aoi");
  const planTask = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, planTask.id, "sora");
  submitArtifact(opened.db, planTask.id, PLAN, "sora");
  const copyTask = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copyTask.id, "kotoha");
  submitArtifact(opened.db, copyTask.id, COPY, "kotoha");
  return { postId: post.id, copyTaskId: copyTask.id };
}

async function render(postId: string): Promise<void> {
  await renderPost(opened.db, postId, "system", { outDirBase: imgDir });
}

function runQa(postId: string, report: unknown, stepKey = "qa-v1"): string {
  const qaTask = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey, priority: 4 }, DATE).task;
  startTask(opened.db, qaTask.id, "shion");
  submitQa(opened.db, qaTask.id, report, "shion");
  return qaTask.id;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-pipe-"));
  imgDir = mkdtempSync(path.join(tmpdir(), "bloom-pipe-img-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(imgDir, { recursive: true, force: true });
});

describe("投稿ライフサイクル", () => {
  it("企画提出でidea→drafting、レンダリング+QA合格でawaiting_approvalへ進む", async () => {
    const { postId } = setupPipeline();
    let post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    expect(post.status).toBe("drafting");
    await render(postId);
    runQa(postId, QA_PASS);
    post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    expect(post.status).toBe("awaiting_approval");
    expect(listApprovalQueue(opened.db).map((i) => i.post.id)).toContain(postId);
  }, 60_000);

  it("QA不合格はdraftingへ差し戻され、承認キューに現れない(AC-15)。画像なしでもfailは記録できる", () => {
    const { postId } = setupPipeline();
    runQa(postId, { ...QA_PASS, result: "fail", issues: ["表現の再考が必要"] });
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    expect(post.status).toBe("drafting");
    expect(listApprovalQueue(opened.db)).toHaveLength(0);
  });

  it("QAを経ない投稿(drafting)は直接承認できない(AC-15の遷移ガード)", () => {
    const { postId } = setupPipeline();
    expect(() => decidePost(opened.db, postId, "approved", null, "owner")).toThrow(/承認待ちでない/);
  });

  it("承認するとapprovals+audit_logにowner記録されapprovedになる(AC-16・UI/API経路の正常系)", async () => {
    const { postId } = setupPipeline();
    await render(postId);
    runQa(postId, QA_PASS);
    // UI(/api/posts/[id]/decision)はこの関数をactor="owner"固定で呼ぶ薄いラッパー
    decidePost(opened.db, postId, "approved", "OKです", "owner");
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    expect(post.status).toBe("approved");
    const approval = opened.db.select().from(t.approvals).where(eq(t.approvals.subjectId, postId)).get()!;
    expect(approval.decision).toBe("approved");
    expect(approval.decidedBy).toBe("owner");
    const audits = opened.db.select().from(t.auditLog).where(and(eq(t.auditLog.subjectId, postId), eq(t.auditLog.action, "approve"))).all();
    expect(audits).toHaveLength(1);
  }, 60_000);

  it("却下は理由必須(なしはエラー)、ありでrejectedになる", async () => {
    const { postId } = setupPipeline();
    await render(postId);
    runQa(postId, QA_PASS);
    expect(() => decidePost(opened.db, postId, "rejected", "", "owner")).toThrow(/理由/);
    decidePost(opened.db, postId, "rejected", "方向性が合わない", "owner");
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("rejected");
  }, 60_000);

  it("修正依頼→copy v2→再レンダリング→再QAで承認待ちへ戻る(AC-17+整合性ゲート)", async () => {
    const { postId } = setupPipeline();
    await render(postId);
    runQa(postId, QA_PASS);
    const { revisionTaskId } = decidePost(opened.db, postId, "revision_requested", "見出しを地域名入りに", "owner");
    expect(revisionTaskId).toBeTruthy();

    const revTask = opened.db.select().from(t.tasks).where(eq(t.tasks.id, revisionTaskId!)).get()!;
    expect(revTask.assigneeId).toBe("emp_kotoha");
    expect(revTask.inputJson).toContain("地域名入り");
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("drafting");

    // 修正版を提出 → 版が+1され、旧版も残る
    startTask(opened.db, revisionTaskId!, "kotoha");
    submitArtifact(opened.db, revisionTaskId!, { ...COPY, headline: "泉州で始めるHPの見せ方" }, "kotoha");
    const copies = opened.db
      .select()
      .from(t.artifacts)
      .where(and(eq(t.artifacts.postId, postId), eq(t.artifacts.kind, "copy")))
      .all();
    expect(copies.map((c) => c.version).sort()).toEqual([1, 2]);

    // 再レンダリング(copy v2由来の画像を生成)後、再QA合格で承認待ちへ
    await render(postId);
    runQa(postId, QA_PASS, "qa-v2");
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("awaiting_approval");
  }, 60_000);

  it("承認済み投稿への再判断は拒否される", async () => {
    const { postId } = setupPipeline();
    await render(postId);
    runQa(postId, QA_PASS);
    decidePost(opened.db, postId, "approved", null, "owner");
    expect(() => decidePost(opened.db, postId, "approved", null, "owner")).toThrow(/承認待ちでない/);
  }, 60_000);
});
