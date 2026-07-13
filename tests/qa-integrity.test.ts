/**
 * P1指摘2(2026-07-13): QA合格時の成果物整合性ゲートのテスト。
 * 最新copy→carousel_spec(sourceCopyArtifactId)→PNG一式の連鎖を不変IDで検証する。
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
  createPost,
  createTask,
  startTask,
  submitArtifact,
  submitQa,
  decidePost,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { PLAN, COPY, QA_PASS } from "./fixtures";

let dir: string;
let imgDir: string;
let opened: OpenedDb;
const DATE = "2026-07-13";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-qagate-"));
  imgDir = mkdtempSync(path.join(tmpdir(), "bloom-qagate-img-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(imgDir, { recursive: true, force: true });
});

function newPost(): string {
  return createPost(opened.db, { pillar: "6", format: "carousel", title: "整合性テスト投稿" }, "aoi").id;
}

function submitPlanFor(postId: string): void {
  const task = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, task.id, "sora");
  submitArtifact(opened.db, task.id, PLAN, "sora");
}

function submitCopyFor(postId: string, stepKey = "copy", headline = COPY.headline): void {
  const task = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId, stepKey, priority: 5 }, DATE).task;
  startTask(opened.db, task.id, "kotoha");
  submitArtifact(opened.db, task.id, { ...COPY, headline }, "kotoha");
}

function qaTaskFor(postId: string, stepKey = "qa-1", assigneeId = "emp_shion", type: "qa" | "research" = "qa"): string {
  const task = createTask(opened.db, { type, title: "QA", assigneeId, postId, stepKey, priority: 4 }, DATE).task;
  startTask(opened.db, task.id, assigneeId.replace("emp_", ""));
  return task.id;
}

describe("QA合格ゲート", () => {
  it("1. 画像なし(未レンダリング)のQA passは拒否される", () => {
    const postId = newPost();
    submitPlanFor(postId);
    submitCopyFor(postId);
    const qa = qaTaskFor(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/carousel_specがありません/);
    // 投稿はawaiting_approvalに進んでいない
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("drafting");
  });

  it("2. post_planがない投稿のQA passは拒否される", () => {
    const postId = newPost();
    submitCopyFor(postId); // planなし(投稿はideaのまま)
    const qa = qaTaskFor(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/post_plan成果物がありません/);
  });

  it("3. copyがない投稿のQA passは拒否される", () => {
    const postId = newPost();
    submitPlanFor(postId);
    const qa = qaTaskFor(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/copy成果物がありません/);
  });

  it("4. copy v2に対して画像がv1由来しかない場合、QA passは拒否される(不変ID比較)", async () => {
    const postId = newPost();
    submitPlanFor(postId);
    submitCopyFor(postId);
    await renderPost(opened.db, postId, "system", { outDirBase: imgDir }); // copy v1由来の画像
    submitCopyFor(postId, "copy-v2", "泉州で始めるHPの見せ方"); // copy v2(再レンダリングなし)
    const qa = qaTaskFor(postId);
    expect(() => submitQa(opened.db, qa, QA_PASS, "shion")).toThrow(/最新copy\(v2\)から生成された画像がありません/);
  }, 60_000);

  it("5. 最新copyから再レンダリングすればQA passできる", async () => {
    const postId = newPost();
    submitPlanFor(postId);
    submitCopyFor(postId);
    await renderPost(opened.db, postId, "system", { outDirBase: imgDir });
    submitCopyFor(postId, "copy-v2", "泉州で始めるHPの見せ方");
    await renderPost(opened.db, postId, "system", { outDirBase: imgDir }); // v2を再レンダリング
    const qa = qaTaskFor(postId, "qa-2");
    const r = submitQa(opened.db, qa, QA_PASS, "shion");
    expect(r.result).toBe("pass");
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("awaiting_approval");
  }, 60_000);

  it("6a. type=qa以外のタスクからはsubmitQaできない", () => {
    const postId = newPost();
    submitPlanFor(postId);
    submitCopyFor(postId);
    const notQa = qaTaskFor(postId, "fake-qa", "emp_shion", "research");
    expect(() => submitQa(opened.db, notQa, QA_PASS, "shion")).toThrow(/type=qaのタスクからのみ/);
  });

  it("6b. 品質管理担当(emp_shion)以外のQAタスクからは提出できない", () => {
    const postId = newPost();
    submitPlanFor(postId);
    submitCopyFor(postId);
    const wrongAssignee = qaTaskFor(postId, "qa-x", "emp_kotoha", "qa");
    expect(() => submitQa(opened.db, wrongAssignee, QA_PASS, "kotoha")).toThrow(/emp_shion/);
  });

  it("承認APIの最終防御: awaiting_approval後に画像が消えた場合、承認は拒否される", async () => {
    const postId = newPost();
    submitPlanFor(postId);
    submitCopyFor(postId);
    await renderPost(opened.db, postId, "system", { outDirBase: imgDir });
    const qa = qaTaskFor(postId);
    submitQa(opened.db, qa, QA_PASS, "shion");
    // 承認待ち到達後にファイルを削除(バックアップ復元漏れ等の想定)
    rmSync(imgDir, { recursive: true, force: true });
    expect(() => decidePost(opened.db, postId, "approved", null, "owner")).toThrow(/画像ファイルが存在しません/);
  }, 60_000);
});
