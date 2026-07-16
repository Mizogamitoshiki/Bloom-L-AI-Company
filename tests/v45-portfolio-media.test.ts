/** V4.5最終修正: 許可済み実績画像の安全な読込・描画・権利再検査。 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDb, type OpenedDb } from "@adapters/db/client";
import {
  addPortfolioItem,
  createPost,
  createTask,
  ensureSeedOrg,
  startTask,
  submitArtifact,
  submitQa,
  updatePermission,
  updatePortfolioAssetsPath,
} from "@adapters/db/store";
import {
  PORTFOLIO_ASSET_DIRECTORY,
  PortfolioMediaError,
  resolvePortfolioAssetFile,
  resolvePortfolioMedia,
} from "@adapters/render/portfolio-media";
import { renderCarousel } from "@adapters/render/renderer";
import { renderPost } from "@adapters/render/render-post";
import { carouselSpecSchema, type PortfolioSpec } from "@core/schemas";
import { PLAN, PORTFOLIO_COPY, QA_PASS } from "./fixtures";

let workspace: string;

async function png(width = 1200, height = 900, color = "#0b46b8"): Promise<Buffer> {
  const image = sharp({ create: { width, height, channels: 3, background: color } });
  if (width < 780 || height < 220) return image.png().toBuffer();
  return image.composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="140"><rect width="700" height="140" rx="30" fill="#fff"/><text x="45" y="90" font-family="sans-serif" font-size="48" font-weight="700" fill="#0b46b8">Bloom-L Portfolio</text></svg>`), left: 80, top: 80 }]).png().toBuffer();
}

function assetDir(itemId: string): string {
  const dir = path.join(workspace, PORTFOLIO_ASSET_DIRECTORY, itemId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "bloom-portfolio-media-"));
  process.env.BLOOM_WORKSPACE_PATH = workspace;
});

afterEach(() => {
  delete process.env.BLOOM_WORKSPACE_PATH;
  rmSync(workspace, { recursive: true, force: true });
});

describe("実績画像の安全な解決", () => {
  it("許可ルート内のPNGをhash化し、白背景sRGB PNGへ正規化する", async () => {
    const itemId = "item-safe";
    writeFileSync(path.join(assetDir(itemId), "site.png"), await png());
    const resolved = await resolvePortfolioMedia(itemId, "site.png");
    expect(resolved.meta.safeRelativePath).toBe(`${PORTFOLIO_ASSET_DIRECTORY}/${itemId}/site.png`);
    expect(resolved.meta.assetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(resolved.dataUri).toMatch(/^data:image\/png;base64,/);
    const normalized = Buffer.from(resolved.dataUri.split(",")[1]!, "base64");
    const meta = await sharp(normalized).metadata();
    const stats = await sharp(normalized).stats();
    expect(meta.space).toBe("srgb");
    expect(meta.channels).toBe(3);
    expect(stats.isOpaque).toBe(true);
  });

  it("絶対パス・path traversal・ルート外symlinkを拒否する", async () => {
    const itemId = "item-escape";
    const dir = assetDir(itemId);
    const outside = path.join(workspace, "outside.png");
    writeFileSync(outside, await png());
    expect(() => resolvePortfolioAssetFile(itemId, outside)).toThrow(/絶対パス/);
    expect(() => resolvePortfolioAssetFile(itemId, "../outside.png")).toThrow(/許可フォルダ/);
    symlinkSync(outside, path.join(dir, "linked.png"));
    expect(() => resolvePortfolioAssetFile(itemId, "linked.png")).toThrow(/symlink/);
  });

  it("SVG・壊れた画像・小さすぎる画像を拒否する", async () => {
    const itemId = "item-invalid";
    const dir = assetDir(itemId);
    writeFileSync(path.join(dir, "site.svg"), "<svg/>");
    writeFileSync(path.join(dir, "broken.png"), "not-a-png");
    writeFileSync(path.join(dir, "small.png"), await png(200, 200));
    expect(() => resolvePortfolioAssetFile(itemId, "site.svg")).toThrow(/PNG\/JPEG\/WebP/);
    await expect(resolvePortfolioMedia(itemId, "broken.png")).rejects.toThrow(PortfolioMediaError);
    await expect(resolvePortfolioMedia(itemId, "small.png")).rejects.toThrow(/小さすぎ/);
  });
});

describe("portfolioテンプレートの実画像描画", () => {
  function baseSpec(media: PortfolioSpec["portfolioMedia"], layoutVariant: "showcase" | "story"): PortfolioSpec {
    return carouselSpecSchema.parse({
      kind: "carousel_spec",
      templateId: "tpl-portfolio",
      pillar: "5",
      sourceCopyArtifactId: "portfolio-media-test",
      layoutVariant,
      slides: PORTFOLIO_COPY.slides,
      displayName: "架空事例",
      anonymous: true,
      portfolioMedia: media,
    }) as PortfolioSpec;
  }

  it("showcaseは実画像を必須とし、画像入り・不透明sRGBで生成する", async () => {
    const itemId = "item-render";
    writeFileSync(path.join(assetDir(itemId), "site.png"), await png());
    const media = await resolvePortfolioMedia(itemId, "site.png");
    const out = mkdtempSync(path.join(tmpdir(), "bloom-pf-render-"));
    try {
      const result = await renderCarousel(baseSpec(media.meta, "showcase"), out, {
        assets: { portfolioImageDataUri: media.dataUri, portfolioAssetSha256: media.meta.assetSha256 },
      });
      expect(result.embeddedAssetSha256).toBe(media.meta.assetSha256);
      expect(readFileSync(result.files[0]!).includes(Buffer.from("Bloom-L Portfolio"))).toBe(false); // PNGへラスタライズ済み
      const meta = await sharp(result.files[0]!).metadata();
      const stats = await sharp(result.files[0]!).stats();
      expect(meta.channels).toBe(3);
      expect(meta.space).toBe("srgb");
      expect(stats.isOpaque).toBe(true);

      // 色の異なる別スクリーンショットは生成画像hashも変わる=実画像が実際に描画へ寄与している
      writeFileSync(path.join(assetDir(itemId), "site-orange.png"), await png(1200, 900, "#e8a13a"));
      const orange = await resolvePortfolioMedia(itemId, "site-orange.png");
      const second = await renderCarousel(baseSpec(orange.meta, "showcase"), out, {
        assets: { portfolioImageDataUri: orange.dataUri, portfolioAssetSha256: orange.meta.assetSha256 },
      });
      expect(second.pageHashes[0]).not.toBe(result.pageHashes[0]);
      expect(second.pageHashes[2]).not.toBe(result.pageHashes[2]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it("showcaseはabstract/画像本体なしを拒否し、story abstractは生成できる", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "bloom-pf-abstract-"));
    try {
      await expect(renderCarousel(baseSpec({ mode: "abstract" }, "showcase"), out)).rejects.toThrow(/showcase/);
      const story = await renderCarousel(baseSpec({ mode: "abstract" }, "story"), out);
      expect(story.pageCount).toBe(6);
      expect(story.embeddedAssetSha256).toBeUndefined();
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("DB権利・素材差し替えの再検査", () => {
  let dbDir: string;
  let opened: OpenedDb;

  beforeEach(() => {
    dbDir = mkdtempSync(path.join(tmpdir(), "bloom-pf-db-"));
    opened = openDb(path.join(dbDir, "test.db"));
    ensureSeedOrg(opened.db);
  });

  afterEach(() => {
    opened.sqlite.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  function planAndCopy(postId: string): void {
    const plan = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId, stepKey: "plan", priority: 5 }, "2026-07-15").task;
    startTask(opened.db, plan.id, "sora");
    submitArtifact(opened.db, plan.id, { ...PLAN, pillar: "5" }, "sora");
    const copy = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId, stepKey: "copy", priority: 5 }, "2026-07-15").task;
    startTask(opened.db, copy.id, "kotoha");
    submitArtifact(opened.db, copy.id, PORTFOLIO_COPY, "kotoha");
  }

  it("scope.screenshot=trueなら実画像showcaseを生成し、差し替え後のQAを拒否する", async () => {
    const { itemId, permissionId } = addPortfolioItem(opened.db, { customerName: "テスト店舗" }, "owner");
    const file = path.join(assetDir(itemId), "site.png");
    writeFileSync(file, await png());
    updatePortfolioAssetsPath(opened.db, itemId, "site.png", "owner");
    const evidenceDir = path.join(workspace, "07_customer-permissions");
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, "consent.png"), "evidence");
    updatePermission(opened.db, permissionId, {
      status: "approved",
      evidencePath: "07_customer-permissions/consent.png",
      scope: { name: true, url: false, screenshot: true, testimonial: false },
    }, "owner");

    const post = createPost(opened.db, { pillar: "5", format: "carousel", title: "画像実績", templateId: "tpl-portfolio", portfolioItemId: itemId }, "aoi");
    planAndCopy(post.id);
    const rendered = await renderPost(opened.db, post.id, "system", { outDirBase: path.join(workspace, "05_generated-posts") });
    if (rendered.skipped) throw new Error("unexpected skip");
    const row = opened.sqlite.prepare("select content_json from artifacts where post_id=? and kind='carousel_spec'").get(post.id) as { content_json: string };
    const spec = carouselSpecSchema.parse(JSON.parse(row.content_json));
    expect(spec.templateId).toBe("tpl-portfolio");
    if (spec.templateId !== "tpl-portfolio") throw new Error("unexpected template");
    expect(spec.layoutVariant).toBe("showcase");
    expect(spec.portfolioMedia.mode).toBe("real_screenshot");

    // 元ファイル差し替え後は、画像に刻印したhashと一致しないためQAへ進めない
    writeFileSync(file, await png(1200, 900, "#e8a13a"));
    const qa = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId: post.id, stepKey: "qa", priority: 4 }, "2026-07-15").task;
    startTask(opened.db, qa.id, "shion");
    expect(() => submitQa(opened.db, qa.id, QA_PASS, "shion")).toThrow(/差し替え|再レンダリング/);
  }, 60_000);

  it("画像が登録済みでもscope.screenshot=falseなら画像を渡さずstory abstractで生成する", async () => {
    const { itemId, permissionId } = addPortfolioItem(opened.db, { customerName: "非画像公開店舗" }, "owner");
    writeFileSync(path.join(assetDir(itemId), "site.png"), await png());
    updatePortfolioAssetsPath(opened.db, itemId, "site.png", "owner");
    const evidenceDir = path.join(workspace, "07_customer-permissions");
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, "consent-no-image.png"), "evidence");
    updatePermission(opened.db, permissionId, {
      status: "approved",
      evidencePath: "07_customer-permissions/consent-no-image.png",
      scope: { name: true, url: false, screenshot: false, testimonial: false },
    }, "owner");

    const post = createPost(opened.db, { pillar: "5", format: "carousel", title: "画像なし実績", templateId: "tpl-portfolio", portfolioItemId: itemId }, "aoi");
    planAndCopy(post.id);
    const rendered = await renderPost(opened.db, post.id, "system", { outDirBase: path.join(workspace, "05_generated-posts") });
    if (rendered.skipped) throw new Error("unexpected skip");
    const row = opened.sqlite.prepare("select content_json from artifacts where post_id=? and kind='carousel_spec'").get(post.id) as { content_json: string };
    const spec = carouselSpecSchema.parse(JSON.parse(row.content_json));
    if (spec.templateId !== "tpl-portfolio") throw new Error("unexpected template");
    expect(spec.layoutVariant).toBe("story");
    expect(spec.portfolioMedia).toEqual({ mode: "abstract" });
  }, 60_000);
});
