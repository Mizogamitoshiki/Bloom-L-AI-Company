/**
 * V4.5 公開停止ガード。未承認版・旧版・fingerprint不一致・design QA失敗のexport拒否、
 * 通常コード合格でもowner未承認テンプレートなら拒否、テンプレート版承認のowner専用。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  ensureSeedOrg, createPost, createTask, startTask, submitArtifact, submitQa, decidePost,
  exportPost, currentTemplateVersion, decideTemplateVersion, getTemplateVersion, latestPostRender,
  assertExportableTemplate,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { computeFingerprint } from "@adapters/render/fingerprint";
import { PLAN, COPY, QA_PASS, approveTemplate, passPostRenderVisualQa } from "./fixtures";

let dir: string, ws: string, opened: OpenedDb;
const DATE = "2026-07-15";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v45g-"));
  ws = mkdtempSync(path.join(tmpdir(), "bloom-v45gws-"));
  process.env.BLOOM_WORKSPACE_PATH = ws;
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});
afterEach(() => {
  delete process.env.BLOOM_WORKSPACE_PATH;
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(ws, { recursive: true, force: true });
});

/** 承認待ち(approved)まで進め、renderPostでpost_render(design QA)を記録する */
async function makeRenderedApproved(title = "ガードテスト"): Promise<string> {
  const post = createPost(opened.db, { pillar: "6", format: "carousel", title }, "aoi");
  const plan = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, plan.id, "sora");
  submitArtifact(opened.db, plan.id, PLAN, "sora");
  const copy = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copy.id, "kotoha");
  submitArtifact(opened.db, copy.id, COPY, "kotoha");
  await renderPost(opened.db, post.id, "system", { outDirBase: path.join(ws, "05_generated-posts") });
  const qa = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId: post.id, stepKey: "qa", priority: 4 }, DATE).task;
  startTask(opened.db, qa.id, "shion");
  submitQa(opened.db, qa.id, QA_PASS, "shion");
  decidePost(opened.db, post.id, "approved", null, "owner");
  passPostRenderVisualQa(opened.db, post.id); // 実運用ではpost_renderに紫苑の視覚QAが紐付く
  return post.id;
}

function approveHowto(): void {
  approveTemplate(opened.db, "tpl-howto");
}

describe("V4.5 公開停止ガード", () => {
  it("テンプレート版が未承認(draft)なら、内容が承認済みでもexportできない", async () => {
    const id = await makeRenderedApproved();
    expect(() => exportPost(opened.db, id, "owner")).toThrow(/承認されていません/);
  }, 60_000);

  it("テンプレート版を代表者が承認するとexportできる", async () => {
    const id = await makeRenderedApproved();
    approveHowto();
    const r = exportPost(opened.db, id, "owner");
    expect(r.skipped).toBe(false);
  }, 60_000);

  it("design QAがfailの画像はexportできない", async () => {
    const id = await makeRenderedApproved();
    approveHowto();
    const render = latestPostRender(opened.db, id)!;
    opened.db.update(t.postRenders).set({ designQaResult: "fail" }).where(eq(t.postRenders.id, render.id)).run();
    expect(() => exportPost(opened.db, id, "owner")).toThrow(/design QA/);
  }, 60_000);

  it("fingerprintが承認時と不一致ならexportできない(旧版/改変)", async () => {
    const id = await makeRenderedApproved();
    approveHowto();
    const render = latestPostRender(opened.db, id)!;
    opened.db.update(t.postRenders).set({ fingerprint: "tampered" }).where(eq(t.postRenders.id, render.id)).run();
    expect(() => exportPost(opened.db, id, "owner")).toThrow(/fingerprint/);
  }, 60_000);

  it("より新しい承認版が存在すると、旧版でレンダリングした画像はexportできない", async () => {
    const id = await makeRenderedApproved();
    approveHowto(); // v1 approved
    // v2 を承認済みで追加(現行の最新承認版=2)。投稿はv1でレンダリング済み
    opened.db.insert(t.templateVersions).values({
      id: "tv-howto-2", templateId: "tpl-howto", family: "education/howto", version: 2, status: "approved",
      fingerprint: computeFingerprint("tpl-howto", 2), createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(), decidedBy: "owner",
    }).run();
    expect(() => exportPost(opened.db, id, "owner")).toThrow(/最新テンプレート版|旧版/);
  }, 60_000);

  it("レンダリング記録が無ければexportできない", () => {
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "未レンダリング" }, "aoi");
    expect(() => assertExportableTemplate(opened.db, post.id)).toThrow(/記録がありません/);
  });

  it("テンプレート版の承認は代表者(owner)のみ", async () => {
    await makeRenderedApproved();
    const ver = currentTemplateVersion(opened.db, "tpl-howto");
    expect(() => decideTemplateVersion(opened.db, { templateId: "tpl-howto", version: ver, decision: "approved" }, "aoi")).toThrow(/代表者/);
    expect(getTemplateVersion(opened.db, "tpl-howto", ver)!.status).toBe("draft");
  }, 60_000);
});
