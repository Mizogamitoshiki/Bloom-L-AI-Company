/**
 * 投稿のカルーセルレンダリング一式(通常コード・AI不使用)。V3-Dでテンプレートレジストリ対応。
 * plan+最新コピー → テンプレート別spec構築(sourceCopyArtifactIdを刻印) → 文字あふれ検査 → PNG生成 → 成果物登録。
 * - tpl-news: 確認済みsourceの紐付けが必須(出典は通常コードが注入)
 * - tpl-portfolio: 公開許可(approved / pending+匿名許可)がなければレンダリング拒否
 */
import path from "node:path";
import type { Db } from "../db/client";
import {
  createTask,
  startTask,
  failTask,
  addRenderArtifacts,
  getPostContent,
  getLinkedSources,
  checkPortfolioRights,
  listPortfolio,
  ensureTemplateVersion,
  renderTemplateVersion,
  recordPostRender,
} from "../db/store";
import { buildSpecFromContent } from "../../core/templates/tpl-howto";
import { templateFor } from "../../core/templates/index";
import type { CarouselSpec, Copy, NewsCopy, PortfolioCopy, CompareCopy } from "../../core/schemas";
import { carouselSpecSchema } from "../../core/schemas";
import { renderCarousel, OverflowError } from "./renderer";
import { runDesignQa } from "./design-qa";
import { findRepoRoot } from "../root";
import { todayLocal } from "../../core/ids";
import { resolvePortfolioMedia, PortfolioMediaError } from "./portfolio-media";
import type { TemplateRenderAssets } from "../../core/templates/index";
import type { SampleCopy } from "../../core/schemas";
import { getSiteSample, siteSampleScreenshots } from "../db/samples";
import { resolveSampleScreenshotMedia, SampleMediaError } from "./sample-media";
import { priceBandFor } from "../config";

export class RightsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RightsError";
  }
}

export type RenderPostResult =
  | { skipped: true; taskId: string; message: string }
  | {
      skipped: false;
      taskId: string;
      pageCount: number;
      files: string[];
      specArtifactId: string;
      imageArtifactIds: string[];
    };

/** V8(D-18): Canva外部レンダリング登録(src/adapters/canva)と共用するためexport。権利・source前提の検査を含む */
export async function buildSpecForPost(
  db: Db,
  postId: string,
  copyArtifactId: string,
): Promise<{ spec: CarouselSpec; assets?: TemplateRenderAssets }> {
  const { post, plan, copy } = getPostContent(db, postId);
  if (!plan) throw new Error(`投稿 ${postId} に post_plan 成果物がありません`);
  if (!copy) throw new Error(`投稿 ${postId} にコピー成果物がありません`);
  const template = templateFor(post.templateId);

  if (template.id === "tpl-howto") {
    return { spec: buildSpecFromContent(plan, copyArtifactId, (copy as Copy).slides) };
  }
  if (template.id === "tpl-news") {
    // 出典はDB登録済みsourcesから注入(V3-B)。AIが出典を書くことはない
    const usable = getLinkedSources(db, postId).filter((s) => s.usable && s.verificationStatus === "confirmed");
    if (usable.length === 0) {
      throw new Error(
        "tpl-newsは確認済みsourceの紐付けが必須です(company source-add → source-link のあとに再実行してください)",
      );
    }
    return { spec: carouselSpecSchema.parse({
      kind: "carousel_spec",
      templateId: "tpl-news",
      pillar: plan.pillar,
      sourceCopyArtifactId: copyArtifactId,
      slides: (copy as NewsCopy).slides,
      sourceRefs: usable.slice(0, 3).map((s) => ({
        title: s.title.slice(0, 80),
        publisher: s.publisher.slice(0, 40),
        publishedAt: s.publishedAt,
      })),
    }) };
  }
  if (template.id === "tpl-compare") {
    return { spec: carouselSpecSchema.parse({
      kind: "carousel_spec",
      templateId: "tpl-compare",
      pillar: plan.pillar,
      sourceCopyArtifactId: copyArtifactId,
      slides: (copy as CompareCopy).slides,
    }) };
  }
  if (template.id === "tpl-sample") {
    // V10: 紬の視覚QAに合格したサンプルの撮影画像だけを使う。価格帯はconfig/pricing.yamlから注入(AIは書かない)
    if (!post.sampleId) throw new Error("tpl-sampleの投稿にsampleIdがありません");
    const sample = getSiteSample(db, post.sampleId);
    if (sample.designQaResult !== "pass") {
      throw new RightsError("サンプルサイトが紬の視覚QA(忠実度)に合格していないためレンダリングできません");
    }
    const shots = siteSampleScreenshots(sample);
    const pcRef = shots.find((s) => s.name === "pc-fold");
    const spRef = shots.find((s) => s.name === "sp-fold");
    if (!pcRef || !spRef) throw new Error("サンプルの撮影画像(pc-fold/sp-fold)が記録されていません");
    let pc: Awaited<ReturnType<typeof resolveSampleScreenshotMedia>>;
    let sp: Awaited<ReturnType<typeof resolveSampleScreenshotMedia>>;
    try {
      pc = await resolveSampleScreenshotMedia(pcRef);
      sp = await resolveSampleScreenshotMedia(spRef);
    } catch (error) {
      if (error instanceof SampleMediaError) throw new RightsError(`サンプル撮影画像を使用できません: ${error.message}`);
      throw error;
    }
    const sampleCopy = copy as SampleCopy;
    const spec = carouselSpecSchema.parse({
      kind: "carousel_spec",
      templateId: "tpl-sample",
      pillar: plan.pillar,
      sourceCopyArtifactId: copyArtifactId,
      slides: sampleCopy.slides,
      sampleId: sample.id,
      sampleTitle: sample.siteTitle,
      screenshots: { pcFold: pcRef, spFold: spRef },
      priceBand: priceBandFor(sampleCopy.slides.plan.planId),
    });
    return {
      spec,
      assets: { sampleShots: { pcFold: { dataUri: pc.dataUri, sha256: pcRef.sha256 }, spFold: { dataUri: sp.dataUri, sha256: spRef.sha256 } } },
    };
  }
  // tpl-portfolio: 許可検査(V3-C)。displayNameは通常コードが決定する
  if (!post.portfolioItemId) throw new Error("tpl-portfolioの投稿にportfolioItemIdがありません");
  const rights = checkPortfolioRights(db, post.portfolioItemId);
  if (!rights.allowed || !rights.displayName) {
    throw new RightsError(`実績素材を使用できません: ${rights.reason}(公開許可の記録が必要です)`);
  }
  const portfolio = listPortfolio(db).find((entry) => entry.item.id === post.portfolioItemId);
  if (!portfolio) throw new RightsError("実績素材が見つかりません");

  // screenshot許可+素材ありなら実画像showcase。許可なし/素材なしは画像を渡さずstoryへ限定する。
  let media: Awaited<ReturnType<typeof resolvePortfolioMedia>> | null = null;
  if (rights.allowedUses.screenshot && portfolio.item.assetsPath) {
    try {
      media = await resolvePortfolioMedia(portfolio.item.id, portfolio.item.assetsPath);
    } catch (error) {
      if (error instanceof PortfolioMediaError) throw new RightsError(`実績画像を使用できません: ${error.message}`);
      throw error;
    }
  }
  const spec = carouselSpecSchema.parse({
    kind: "carousel_spec",
    templateId: "tpl-portfolio",
    pillar: plan.pillar,
    sourceCopyArtifactId: copyArtifactId,
    layoutVariant: media ? "showcase" : "story",
    slides: (copy as PortfolioCopy).slides,
    displayName: rights.displayName,
    anonymous: rights.mode === "anonymous",
    portfolioMedia: media?.meta ?? { mode: "abstract" },
  });
  return {
    spec,
    ...(media ? { assets: { portfolioImageDataUri: media.dataUri, portfolioAssetSha256: media.meta.assetSha256 } } : {}),
  };
}

/**
 * 文字あふれ時: renderタスクを即failed(fatal)+琴葉への短縮タスクを自動生成した上でOverflowErrorを再throwする。
 * 権利エラー(RightsError)はタスク作成前に発生し、レンダリングは開始されない。
 */
export async function renderPost(
  db: Db,
  postId: string,
  actor = "system",
  opts: { outDirBase?: string } = {},
): Promise<RenderPostResult> {
  const { post, copy, copyVersion, copyArtifactId } = getPostContent(db, postId);
  if (!copy || copyVersion === null || !copyArtifactId) throw new Error(`投稿 ${postId} にコピー成果物がありません`);

  // 権利・source前提の検査はタスク生成前に行う(不許可素材はレンダリング自体を開始しない)
  const built = await buildSpecForPost(db, postId, copyArtifactId);
  const { spec } = built;

  const { task, created } = createTask(
    db,
    {
      type: "render",
      title: `カルーセル生成 v${copyVersion}: ${post.title}`.slice(0, 120),
      assigneeId: "emp_tsumugi",
      postId,
      stepKey: `render-${copyArtifactId}`,
      priority: 5,
    },
    todayLocal(),
    actor,
  );
  if (!created && task.status === "done") {
    return { skipped: true, taskId: task.id, message: `コピー v${copyVersion} は既にレンダリング済み(冪等)` };
  }
  if (task.status === "queued") startTask(db, task.id, actor);

  const base = opts.outDirBase ?? path.join(findRepoRoot(), "data", "workspace", "05_generated-posts");
  const outDir = path.join(base, postId, `v${copyVersion}`);
  try {
    // 承認済み版のコードが現行実装と一致していればその版で、そうでなければ現行版でレンダリング
    // (未決定のdraft版が残っていてもexport可能な承認済み版を優先する。fingerprint整合)
    ensureTemplateVersion(db, spec.templateId, actor);
    const templateVersion = renderTemplateVersion(db, spec.templateId);
    const result = await renderCarousel(spec, outDir, { templateVersion, assets: built.assets });
    const saved = addRenderArtifacts(db, task.id, spec, result.files, actor);
    // design QA(通常コード)を実行し、レンダリング記録を残す(公開停止ガードの根拠)
    const designQa = await runDesignQa(spec, {
      files: result.files, pageCount: result.pageCount, variant: result.variant, fingerprint: result.fingerprint, templateVersion,
      embeddedAssetSha256: result.embeddedAssetSha256,
    });
    recordPostRender(db, {
      postId, specArtifactId: saved.specArtifactId, templateId: spec.templateId, templateVersion,
      variant: result.variant, fingerprint: result.fingerprint, designQa,
    }, actor);
    return { skipped: false, taskId: task.id, pageCount: result.pageCount, files: result.files, ...saved };
  } catch (err) {
    if (err instanceof OverflowError) {
      failTask(db, task.id, err.message, actor, { fatal: true });
      createTask(
        db,
        {
          type: "write_copy",
          title: `文字あふれ修正: ${post.title}`.slice(0, 120),
          assigneeId: "emp_kotoha",
          postId,
          stepKey: `copy-shorten-${copyArtifactId}`,
          priority: 3,
          input: {
            overflows: err.overflows.map((o) => ({ slot: o.slotPath, over: `${Math.ceil(o.measuredHeight)}px/${o.maxHeight}px` })),
          },
        },
        todayLocal(),
        actor,
      );
      throw err;
    }
    failTask(db, task.id, err instanceof Error ? err.message : String(err), actor, { fatal: true });
    throw err;
  }
}
