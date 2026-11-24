/**
 * レンダリング版選択(renderTemplateVersion)の回帰テスト。
 * 実運用で起きた「代表者が承認したのにexportで『承認されていません』と言われる」事故:
 * 未決定のdraft版が最大番号に残っていると、renderが常に最大番号を刻印してしまい、
 * 承認済み版が存在してもexportが構造的に止まっていた。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  ensureSeedOrg, createPost, createTask, startTask, submitArtifact, submitQa, decidePost,
  exportPost, renderTemplateVersion, ensureTemplateVersionAt, latestPostRender,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { PLAN, COPY, QA_PASS, approveTemplate, passPostRenderVisualQa } from "./fixtures";

let dir: string, ws: string, opened: OpenedDb;
const DATE = "2026-07-19";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-tvs-"));
  ws = mkdtempSync(path.join(tmpdir(), "bloom-tvsws-"));
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

/** 企画→コピー→render→視覚QA→内容QA→代表者承認まで進める */
async function makeApprovedPost(title: string): Promise<string> {
  const post = createPost(opened.db, { pillar: "6", format: "carousel", title }, "aoi");
  const plan = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, plan.id, "sora");
  submitArtifact(opened.db, plan.id, PLAN, "sora");
  const copy = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copy.id, "kotoha");
  submitArtifact(opened.db, copy.id, COPY, "kotoha");
  await renderPost(opened.db, post.id, "system", { outDirBase: path.join(ws, "05_generated-posts") });
  passPostRenderVisualQa(opened.db, post.id);
  const qa = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId: post.id, stepKey: "qa", priority: 4 }, DATE).task;
  startTask(opened.db, qa.id, "shion");
  submitQa(opened.db, qa.id, QA_PASS, "shion");
  decidePost(opened.db, post.id, "approved", null, "owner");
  return post.id;
}

describe("renderTemplateVersion: 承認済み版の優先", () => {
  it("未決定のdraft版が最大番号にあっても、承認済み版でレンダリングされexportできる", async () => {
    approveTemplate(opened.db, "tpl-howto"); // v1 approved(コードは以後不変)
    ensureTemplateVersionAt(opened.db, "tpl-howto", 2); // draft v2 が最大番号に残る
    expect(renderTemplateVersion(opened.db, "tpl-howto")).toBe(1);
    const id = await makeApprovedPost("draft版が残っていても公開できる");
    expect(latestPostRender(opened.db, id)!.templateVersion).toBe(1);
    const r = exportPost(opened.db, id, "owner");
    expect(r.skipped).toBe(false);
  }, 60_000);

  it("承認済み版のコードが現行実装と乖離している場合は現行版(最大番号)を使う", () => {
    approveTemplate(opened.db, "tpl-howto"); // v1 approved
    ensureTemplateVersionAt(opened.db, "tpl-howto", 2);
    // 承認後のコード変更をfingerprint改変で模擬(現行実装との一致が壊れる)
    opened.db.update(t.templateVersions)
      .set({ fingerprint: "stale-after-approval" })
      .where(and(eq(t.templateVersions.templateId, "tpl-howto"), eq(t.templateVersions.version, 1)))
      .run();
    expect(renderTemplateVersion(opened.db, "tpl-howto")).toBe(2);
  });

  it("承認済み版が無ければ現行版(最大番号)を使う", () => {
    ensureTemplateVersionAt(opened.db, "tpl-howto", 3);
    expect(renderTemplateVersion(opened.db, "tpl-howto")).toBe(3);
  });
});
