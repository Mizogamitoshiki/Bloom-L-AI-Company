/**
 * V8(D-18): Canva外部レンダリング登録のテスト。
 * - 正常系: 期待枚数・寸法の連番PNG → 登録成功・design QA pass・renderEngine=canva
 * - 整合ゲート: 視覚QA passでexportゲート(assertExportableTemplate)を通過し、
 *   登録後にファイルを改変するとcontent hash不一致で拒否される(fail closed)
 * - 異常系: 枚数不足は登録自体を拒否 / 寸法不正はdesign QA failとして記録されexport不可
 * - 冪等性: 同一コピー版の再登録はskipped
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
  latestPostRender,
  assertExportableTemplate,
  submitQa,
} from "@adapters/db/store";
import { registerCanvaRender, registerHybridRender } from "@adapters/canva/register";
import { PLAN, COPY, QA_PASS, passPostRenderVisualQa } from "./fixtures";

let dir: string;
let srcDir: string;
let outBase: string;
let opened: OpenedDb;
const DATE = "2026-07-24";
const DESIGN_ID = "DAHQR1_UpS0";

function setupPost(): string {
  const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "Canvaテスト投稿" }, "aoi");
  const planTask = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, planTask.id, "sora");
  submitArtifact(opened.db, planTask.id, PLAN, "sora");
  const copyTask = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copyTask.id, "kotoha");
  submitArtifact(opened.db, copyTask.id, COPY, "kotoha");
  return post.id;
}

async function writePngs(count: number, width = 1080, height = 1350): Promise<void> {
  for (let i = 1; i <= count; i++) {
    const name = `${String(i).padStart(2, "0")}.png`;
    // ページごとに色を変えて内容を一意にする
    await sharp({ create: { width, height, channels: 3, background: { r: 20 + i * 10, g: 40, b: 90 } } })
      .png()
      .toFile(path.join(srcDir, name));
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-canva-"));
  srcDir = mkdtempSync(path.join(tmpdir(), "bloom-canva-src-"));
  outBase = mkdtempSync(path.join(tmpdir(), "bloom-canva-out-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(srcDir, { recursive: true, force: true });
  rmSync(outBase, { recursive: true, force: true });
});

describe("registerCanvaRender(V8/D-18)", () => {
  it("期待枚数・寸法の連番PNGを登録でき、design QA passのpost_render(canva)が残る", async () => {
    const postId = setupPost();
    await writePngs(6); // tpl-howto: cover+3pages+summary+CTA = 6
    const result = await registerCanvaRender(opened.db, postId, srcDir, DESIGN_ID, "aoi", { outDirBase: outBase });
    expect(result.skipped).toBe(false);
    expect(result.pageCount).toBe(6);
    const render = latestPostRender(opened.db, postId)!;
    expect(render.renderEngine).toBe("canva");
    expect(render.externalRef).toBe(DESIGN_ID);
    expect(render.designQaResult).toBe("pass");
    expect(render.fingerprint.startsWith("canva-")).toBe(true);
  }, 30_000);

  it("視覚QA pass後はexportゲートを通過し、画像を改変するとcontent hash不一致で拒否される", async () => {
    const postId = setupPost();
    await writePngs(6);
    const result = await registerCanvaRender(opened.db, postId, srcDir, DESIGN_ID, "aoi", { outDirBase: outBase });
    // QA(内容+視覚)を通してawaiting_approvalへ(実運用と同じ経路)
    const qaTask = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey: "qa-v1", priority: 4 }, DATE).task;
    startTask(opened.db, qaTask.id, "shion");
    passPostRenderVisualQa(opened.db, postId);
    submitQa(opened.db, qaTask.id, QA_PASS, "shion");
    // exportゲート: canva分岐(content hash再計算)を通過する
    const gate = assertExportableTemplate(opened.db, postId);
    expect(gate.fingerprint.startsWith("canva-")).toBe(true);
    // 登録済みファイルを改変 → 拒否(fail closed)
    writeFileSync(result.files[0]!, "tampered");
    expect(() => assertExportableTemplate(opened.db, postId)).toThrow(/一致しません/);
  }, 30_000);

  it("ページ数不足は登録自体を拒否する", async () => {
    const postId = setupPost();
    await writePngs(5);
    await expect(registerCanvaRender(opened.db, postId, srcDir, DESIGN_ID, "aoi", { outDirBase: outBase })).rejects.toThrow(
      /ページ数が不一致/,
    );
  }, 30_000);

  it("寸法不正はdesign QA failとして記録され、exportゲートが拒否する", async () => {
    const postId = setupPost();
    await writePngs(6, 1080, 1080); // 正方形(不正)
    await registerCanvaRender(opened.db, postId, srcDir, DESIGN_ID, "aoi", { outDirBase: outBase });
    const render = latestPostRender(opened.db, postId)!;
    expect(render.designQaResult).toBe("fail");
    expect(() => assertExportableTemplate(opened.db, postId)).toThrow(/design QA/i);
  }, 30_000);

  it("同一コピー版の再登録は冪等(skipped)", async () => {
    const postId = setupPost();
    await writePngs(6);
    await registerCanvaRender(opened.db, postId, srcDir, DESIGN_ID, "aoi", { outDirBase: outBase });
    const second = await registerCanvaRender(opened.db, postId, srcDir, DESIGN_ID, "aoi", { outDirBase: outBase });
    expect(second.skipped).toBe(true);
  }, 30_000);

  it("不正なCanvaデザインID形式は拒否する", async () => {
    const postId = setupPost();
    mkdirSync(srcDir, { recursive: true });
    await expect(registerCanvaRender(opened.db, postId, srcDir, "invalid-id", "aoi", { outDirBase: outBase })).rejects.toThrow(
      /デザインID/,
    );
  });
});

describe("registerHybridRender(V8/D-18 ハイブリッド)", () => {
  async function writeCover(width = 1080, height = 1350): Promise<string> {
    const p = path.join(srcDir, "cover.png");
    await sharp({ create: { width, height, channels: 3, background: { r: 27, g: 42, b: 74 } } }).png().toFile(p);
    return p;
  }

  it("表紙Canva+本文Satoriを結合登録でき、engine=hybrid・design QA passになる", async () => {
    const postId = setupPost();
    const cover = await writeCover();
    const result = await registerHybridRender(opened.db, postId, cover, DESIGN_ID, "aoi", { outDirBase: outBase });
    expect(result.skipped).toBe(false);
    expect(result.pageCount).toBe(6); // COPY: 3 pages + cover/summary/cta
    const render = latestPostRender(opened.db, postId)!;
    expect(render.renderEngine).toBe("hybrid");
    expect(render.externalRef).toBe(DESIGN_ID);
    expect(render.designQaResult).toBe("pass");
  }, 40_000);

  it("視覚QA pass後はexportゲートを通過し、結合画像の改変はcontent hash不一致で拒否される", async () => {
    const postId = setupPost();
    const cover = await writeCover();
    const result = await registerHybridRender(opened.db, postId, cover, DESIGN_ID, "aoi", { outDirBase: outBase });
    const qaTask = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey: "qa-v1", priority: 4 }, DATE).task;
    startTask(opened.db, qaTask.id, "shion");
    passPostRenderVisualQa(opened.db, postId);
    submitQa(opened.db, qaTask.id, QA_PASS, "shion");
    expect(assertExportableTemplate(opened.db, postId).fingerprint.startsWith("canva-")).toBe(true);
    writeFileSync(result.files[1]!, "tampered"); // 本文ページを改変
    expect(() => assertExportableTemplate(opened.db, postId)).toThrow(/一致しません/);
  }, 40_000);

  it("表紙PNGが1080x1350でなければ拒否する", async () => {
    const postId = setupPost();
    const cover = await writeCover(1080, 1080);
    await expect(registerHybridRender(opened.db, postId, cover, DESIGN_ID, "aoi", { outDirBase: outBase })).rejects.toThrow(
      /1080x1350/,
    );
  }, 40_000);
});
