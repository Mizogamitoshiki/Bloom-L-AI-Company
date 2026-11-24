/**
 * V8(D-18, 2026-07-24): Canva外部レンダリングの登録。
 * CanvaのMCP書き出し(オーケストレーターが即時ダウンロードしたPNG一式)を、
 * 既存の成果物整合チェーン(最新copy → carousel_spec → image一式)へ通常コードで組み込む。
 *
 * ガード(Satori経路との差分を補償する):
 * - specは既存のbuildSpecForPost(権利・source前提検査込み)で最新copyから構築(整合ゲート維持)
 * - ページ数はテンプレート期待枚数と一致必須 / 全PNGは1080x1350実測必須
 * - fingerprintは画像内容ハッシュ(content-addressed)。export時に再計算一致を検査(store側)
 * - 文字あふれ機械検査は存在しないため、紫苑の視覚QA(fail closed)が公開前に必須である点は不変
 */
import path from "node:path";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import sharp from "sharp";
import type { Db } from "../db/client";
import {
  createTask,
  startTask,
  addRenderArtifacts,
  getPostContent,
  recordPostRender,
  computeExternalRenderHash,
} from "../db/store";
import { buildSpecForPost } from "../render/render-post";
import { renderCarousel } from "../render/renderer";
import { templateFor } from "../../core/templates/index";
import type { CarouselSpec, DesignQaResult } from "../../core/schemas";
import { findRepoRoot } from "../root";
import { todayLocal } from "../../core/ids";

const CANVAS = { width: 1080, height: 1350 } as const;

export interface CanvaRegisterResult {
  skipped: boolean;
  taskId: string;
  pageCount: number;
  files: string[];
  specArtifactId?: string;
  imageArtifactIds?: string[];
  postRenderId?: string;
  message?: string;
}

/** 外部PNG一式の機械的design QA(寸法・連番・枚数)。コード版fingerprint検査の代替はcontent hash(store側) */
async function runExternalDesignQa(spec: CarouselSpec, files: string[], contentHash: string): Promise<DesignQaResult> {
  const checks: { id: string; ok: boolean; detail: string }[] = [];
  const expected = templateFor(spec.templateId).expectedPages(spec);

  const inRange = files.length >= 6 && files.length <= 9;
  checks.push({
    id: "page-count",
    ok: files.length === expected && inRange,
    detail: `${files.length}枚(期待${expected}・目標6〜9)`,
  });

  let filesOk = true;
  for (let i = 0; i < files.length; i++) {
    const expectName = `${String(i + 1).padStart(2, "0")}.png`;
    if (path.basename(files[i]!) !== expectName || !existsSync(files[i]!)) filesOk = false;
  }
  checks.push({ id: "image-sequence", ok: filesOk, detail: filesOk ? "01.png..連番で実在" : "画像の連番/実在に不整合" });

  let dimsOk = true;
  const badDims: string[] = [];
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    const m = existsSync(f) ? await sharp(f).metadata() : null;
    if (m?.width !== CANVAS.width || m?.height !== CANVAS.height) {
      dimsOk = false;
      badDims.push(`${path.basename(f)}(${m?.width ?? "?"}x${m?.height ?? "?"})`);
    }
  }
  checks.push({
    id: "dimensions",
    ok: dimsOk,
    detail: dimsOk ? `全ページ${CANVAS.width}x${CANVAS.height}` : `寸法不一致: ${badDims.join(", ")}`,
  });

  const failures = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
  return {
    kind: "design_qa",
    result: failures.length === 0 ? "pass" : "fail",
    templateId: spec.templateId,
    templateVersion: 0,
    variant: "canva",
    fingerprint: contentHash,
    pageCount: files.length,
    checks,
    failures,
  };
}

/**
 * srcDir内の 01.png..NN.png を検証し、workspaceへ複製して成果物・post_renderを登録する。
 * 検証failでも登録は行う(design_qa_result=failのpost_renderが残り、exportゲートが構造的に拒否する)。
 */
export async function registerCanvaRender(
  db: Db,
  postId: string,
  srcDir: string,
  canvaDesignId: string,
  actor = "system",
  opts: { outDirBase?: string } = {},
): Promise<CanvaRegisterResult> {
  if (!/^D[a-zA-Z0-9_-]{10}$/.test(canvaDesignId)) {
    throw new Error(`CanvaデザインIDの形式が不正です: ${canvaDesignId}(Dで始まる11文字)`);
  }
  const { post, copy, copyVersion, copyArtifactId } = getPostContent(db, postId);
  if (!copy || copyVersion === null || !copyArtifactId) throw new Error(`投稿 ${postId} にコピー成果物がありません`);

  // 権利・source前提の検査を含む(tpl-newsのsource必須・tpl-portfolioの許可検査はSatori経路と同一)
  const built = await buildSpecForPost(db, postId, copyArtifactId);
  const { spec } = built;
  const expected = templateFor(spec.templateId).expectedPages(spec);

  if (!existsSync(srcDir)) throw new Error(`ディレクトリが存在しません: ${srcDir}`);
  const pngs = readdirSync(srcDir)
    .filter((f) => /^\d{2}\.png$/.test(f))
    .sort();
  if (pngs.length === 0) throw new Error(`${srcDir} に 01.png 形式の連番PNGがありません`);
  if (pngs.length !== expected) {
    throw new Error(
      `ページ数が不一致です(${pngs.length}枚 / テンプレート${spec.templateId}の期待${expected}枚)。カバー・本文・CTAの全ページを書き出してください`,
    );
  }
  for (let i = 0; i < pngs.length; i++) {
    const expectName = `${String(i + 1).padStart(2, "0")}.png`;
    if (pngs[i] !== expectName) throw new Error(`連番が不正です: ${pngs[i]}(期待: ${expectName})`);
  }

  const orderedSrc = pngs.map((name) => path.join(srcDir, name));
  return registerPngSet(db, {
    postId, post, spec, copyVersion, copyArtifactId, orderedSrc,
    engine: "canva", variant: "canva", externalRef: canvaDesignId,
    titlePrefix: "Canvaカルーセル登録", stepKeyKind: "canva", outDirSuffix: "canva",
    outDirBase: opts.outDirBase,
  }, actor);
}

/**
 * V8(D-18) 2026-07-27: ハイブリッド登録。表紙(1枚目)だけCanva書き出しPNGに差し替え、
 * 本文〜CTAは通常コード(Satori)でレンダリングして1つのカルーセルに結合する。
 * Canvaの得意(短文カバーの美しさ)とSatoriの確実さ(全文字・事故ゼロ)を両取りする。
 * - 表紙PNGは1080x1350必須(それ以外は拒否)
 * - 本文は現行テーマ(濃紺×ゴールド)でレンダリング。全文字が確実に入る
 * - fingerprintは結合後の画像内容ハッシュ。export時に再計算一致でQA後の改変を検知
 */
export async function registerHybridRender(
  db: Db,
  postId: string,
  coverPng: string,
  canvaCoverDesignId: string,
  actor = "system",
  opts: { outDirBase?: string } = {},
): Promise<CanvaRegisterResult> {
  if (!/^D[a-zA-Z0-9_-]{10}$/.test(canvaCoverDesignId)) {
    throw new Error(`CanvaカバーのデザインIDの形式が不正です: ${canvaCoverDesignId}(Dで始まる11文字)`);
  }
  if (!existsSync(coverPng)) throw new Error(`カバー画像が存在しません: ${coverPng}`);
  const coverMeta = await sharp(coverPng).metadata();
  if (coverMeta.width !== CANVAS.width || coverMeta.height !== CANVAS.height) {
    throw new Error(`カバー画像は${CANVAS.width}x${CANVAS.height}が必要です(現在: ${coverMeta.width}x${coverMeta.height})`);
  }
  const { post, copy, copyVersion, copyArtifactId } = getPostContent(db, postId);
  if (!copy || copyVersion === null || !copyArtifactId) throw new Error(`投稿 ${postId} にコピー成果物がありません`);

  const built = await buildSpecForPost(db, postId, copyArtifactId);
  const { spec } = built;

  // Satori本文を一時ディレクトリへレンダリング(全ページ)。文字あふれ時はOverflowErrorが上がる
  const base = opts.outDirBase ?? path.join(findRepoRoot(), "data", "workspace", "05_generated-posts");
  const outDir = path.join(base, postId, `v${copyVersion}-hybrid`);
  mkdirSync(outDir, { recursive: true });
  const rendered = await renderCarousel(spec, outDir, { assets: built.assets });
  const orderedSrc = [...rendered.files].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  // 1枚目(01.png)をCanvaカバーで上書き
  copyFileSync(coverPng, orderedSrc[0]!);

  return registerPngSet(db, {
    postId, post, spec, copyVersion, copyArtifactId, orderedSrc,
    engine: "hybrid", variant: "hybrid", externalRef: canvaCoverDesignId,
    titlePrefix: "ハイブリッド登録(Canva表紙+Satori本文)", stepKeyKind: "hybrid", outDirSuffix: "hybrid",
    // 既にoutDirへレンダリング済みなので再コピー不要
    inPlace: true, outDirBase: opts.outDirBase,
  }, actor);
}

/** Canva/ハイブリッド共通: ordered PNGを成果物+post_render(content hash)として登録する */
async function registerPngSet(
  db: Db,
  a: {
    postId: string; post: { title: string }; spec: CarouselSpec; copyVersion: number; copyArtifactId: string;
    orderedSrc: string[]; engine: "canva" | "hybrid"; variant: string; externalRef: string;
    titlePrefix: string; stepKeyKind: string; outDirSuffix: string; inPlace?: boolean; outDirBase?: string;
  },
  actor: string,
): Promise<CanvaRegisterResult> {
  const { task, created } = createTask(
    db,
    {
      type: "render",
      title: `${a.titlePrefix} v${a.copyVersion}: ${a.post.title}`.slice(0, 120),
      assigneeId: "emp_tsubaki",
      postId: a.postId,
      stepKey: `render-${a.stepKeyKind}-${a.copyArtifactId}`,
      priority: 5,
    },
    todayLocal(),
    actor,
  );
  if (!created && task.status === "done") {
    return { skipped: true, taskId: task.id, pageCount: 0, files: [], message: `コピー v${a.copyVersion} は既に登録済み(冪等)` };
  }
  if (task.status === "queued") startTask(db, task.id, actor);

  let destFiles: string[];
  if (a.inPlace) {
    destFiles = a.orderedSrc;
  } else {
    const base = a.outDirBase ?? path.join(findRepoRoot(), "data", "workspace", "05_generated-posts");
    const outDir = path.join(base, a.postId, `v${a.copyVersion}-${a.outDirSuffix}`);
    mkdirSync(outDir, { recursive: true });
    destFiles = a.orderedSrc.map((src, i) => {
      const dest = path.join(outDir, `${String(i + 1).padStart(2, "0")}.png`);
      copyFileSync(src, dest);
      return dest;
    });
  }

  const saved = addRenderArtifacts(db, task.id, a.spec, destFiles, actor);
  const contentHash = computeExternalRenderHash(db, saved.specArtifactId);
  const designQa = await runExternalDesignQa(a.spec, destFiles, contentHash);
  const postRenderId = recordPostRender(
    db,
    {
      postId: a.postId, specArtifactId: saved.specArtifactId, templateId: a.spec.templateId, templateVersion: 0,
      variant: a.variant, fingerprint: contentHash, designQa, renderEngine: a.engine, externalRef: a.externalRef,
    },
    actor,
  );
  return {
    skipped: false, taskId: task.id, pageCount: destFiles.length, files: destFiles, postRenderId, ...saved,
    ...(designQa.result === "fail" ? { message: `design QA fail: ${designQa.failures.join(" / ")}` } : {}),
  };
}
