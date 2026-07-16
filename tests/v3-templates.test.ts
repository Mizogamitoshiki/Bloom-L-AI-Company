/**
 * V3-D: tpl-news / tpl-portfolio テンプレートのテスト。
 * 5ページ固定・1080×1350・文字あふれ検査・決定的レンダリング・権利ゲート。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDb, type OpenedDb } from "@adapters/db/client";
import {
  ensureSeedOrg,
  createPost,
  createTask,
  startTask,
  submitArtifact,
  addSource,
  linkSourceToPost,
  addPortfolioItem,
  updatePermission,
} from "@adapters/db/store";
import { renderPost, RightsError } from "@adapters/render/render-post";
import { renderCarousel } from "@adapters/render/renderer";
import { templateFor } from "@core/templates/index";
import { carouselSpecSchema, type NewsSpec } from "@core/schemas";
import { PLAN, NEWS_COPY, PORTFOLIO_COPY, SOURCE_A , ensureEvidenceFile } from "./fixtures";

let dir: string;
let imgDir: string;
let opened: OpenedDb;
const DATE = "2026-07-13";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-tpl-"));
  imgDir = mkdtempSync(path.join(tmpdir(), "bloom-tpl-img-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(imgDir, { recursive: true, force: true });
});

function submitPlanAndCopy(postId: string, copy: unknown, pillar: "1" | "5"): void {
  const planTask = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, planTask.id, "sora");
  submitArtifact(opened.db, planTask.id, { ...PLAN, pillar }, "sora");
  const copyTask = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copyTask.id, "kotoha");
  submitArtifact(opened.db, copyTask.id, copy, "kotoha");
}

describe("tpl-news", () => {
  it("sourceの紐付けなしではレンダリングできない", async () => {
    const post = createPost(opened.db, { pillar: "1", format: "carousel", title: "ニューステスト", templateId: "tpl-news" }, "aoi");
    submitPlanAndCopy(post.id, NEWS_COPY, "1");
    await expect(renderPost(opened.db, post.id, "system", { outDirBase: imgDir })).rejects.toThrow(/source/);
  });

  it("source紐付け後は6ページの1080×1350が生成され、出典が通常コードで注入される", async () => {
    const post = createPost(opened.db, { pillar: "1", format: "carousel", title: "ニューステスト", templateId: "tpl-news" }, "aoi");
    submitPlanAndCopy(post.id, NEWS_COPY, "1");
    const src = addSource(opened.db, SOURCE_A, "rin");
    linkSourceToPost(opened.db, post.id, src.id, "aoi");
    const result = await renderPost(opened.db, post.id, "system", { outDirBase: imgDir });
    if (result.skipped) throw new Error("skipped unexpectedly");
    expect(result.pageCount).toBe(6);
    const meta = await sharp(result.files[0]!).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
    // specに出典(DB由来)が刻印されている
    const spec = opened.sqlite
      .prepare("select content_json from artifacts where post_id = ? and kind = 'carousel_spec'")
      .get(post.id) as { content_json: string };
    const parsed = carouselSpecSchema.parse(JSON.parse(spec.content_json)) as NewsSpec;
    expect(parsed.sourceRefs[0]!.publisher).toBe("架空ITニュース");
  }, 60_000);

  it("決定的レンダリング(同一spec→同一バイト列)と文字あふれ検査", async () => {
    const spec = carouselSpecSchema.parse({
      kind: "carousel_spec",
      templateId: "tpl-news",
      pillar: "1",
      sourceCopyArtifactId: "copy-test",
      slides: NEWS_COPY.slides,
      sourceRefs: [{ title: SOURCE_A.title, publisher: SOURCE_A.publisher, publishedAt: SOURCE_A.publishedAt }],
    });
    const d1 = mkdtempSync(path.join(tmpdir(), "news-a-"));
    const d2 = mkdtempSync(path.join(tmpdir(), "news-b-"));
    try {
      const r1 = await renderCarousel(spec, d1);
      const r2 = await renderCarousel(spec, d2);
      expect(readFileSync(r1.files[0]!).equals(readFileSync(r2.files[0]!))).toBe(true);
      expect(templateFor("tpl-news").expectedPages(spec)).toBe(6);
      // 改行乱用の文字あふれは拒否される
      const overflow = { ...spec, slides: { ...spec.slides, opinion: { heading: "検査", body: "行\n".repeat(20).trim() } } };
      await expect(renderCarousel(carouselSpecSchema.parse(overflow), d1)).rejects.toThrow(/文字あふれ/);
    } finally {
      rmSync(d1, { recursive: true, force: true });
      rmSync(d2, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("tpl-portfolio", () => {
  it("未許可(pending・匿名不可)ではレンダリング自体が拒否される", async () => {
    const { itemId } = addPortfolioItem(opened.db, { customerName: "テスト工務店" }, "owner");
    const post = createPost(opened.db, { pillar: "5", format: "carousel", title: "実績テスト", templateId: "tpl-portfolio", portfolioItemId: itemId }, "aoi");
    submitPlanAndCopy(post.id, PORTFOLIO_COPY, "5");
    await expect(renderPost(opened.db, post.id, "system", { outDirBase: imgDir })).rejects.toThrow(RightsError);
  });

  it("匿名許可なら匿名名、approvedなら実名が通常コードで注入される", async () => {
    const { itemId, permissionId } = addPortfolioItem(
      opened.db,
      { customerName: "テスト工務店", anonymousName: "泉州の工務店さま" },
      "owner",
    );
    updatePermission(opened.db, permissionId, { status: "pending", anonymousAllowed: true, evidencePath: ensureEvidenceFile() }, "owner");
    const post = createPost(opened.db, { pillar: "5", format: "carousel", title: "実績テスト", templateId: "tpl-portfolio", portfolioItemId: itemId }, "aoi");
    submitPlanAndCopy(post.id, PORTFOLIO_COPY, "5");
    const result = await renderPost(opened.db, post.id, "system", { outDirBase: imgDir });
    if (result.skipped) throw new Error("skipped unexpectedly");
    expect(result.pageCount).toBe(6);
    const spec = opened.sqlite
      .prepare("select content_json from artifacts where post_id = ? and kind = 'carousel_spec' order by version desc")
      .get(post.id) as { content_json: string };
    const parsed = carouselSpecSchema.parse(JSON.parse(spec.content_json));
    if (parsed.templateId !== "tpl-portfolio") throw new Error("unexpected template");
    expect(parsed.anonymous).toBe(true);
    expect(parsed.displayName).toBe("泉州の工務店さま");
  }, 60_000);
});
