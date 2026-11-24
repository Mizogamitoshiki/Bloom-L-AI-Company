/**
 * V10 サイトサンプルの素材・撮影画像の安全な解決(docs/32)。portfolio-media.ts と同じ原則:
 * - 素材は workspace/02_site-samples/<requestId>/input/ 配下、撮影PNGは同 /v<n>/shots/ 配下だけを許可
 * - 絶対パス・path traversal・ルート外symlink・未対応形式・巨大画像を拒否
 * - DB/specには相対パス・SHA-256・寸法だけを記録し、画像本体は保存しない
 * - Satoriへ渡す直前だけ、Sharpで白背景・sRGB・PNGへ正規化したdata URIを作る
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { workspaceRoot } from "../root";
import type { SampleScreenshotRef } from "../../core/schemas";

export const SAMPLE_DIRECTORY = "02_site-samples";
export const SAMPLE_INPUT_DIR = "input";
export const SAMPLE_SHOTS_DIR = "shots";
export const MAX_SAMPLE_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_SAMPLE_ASSET_PIXELS = 50_000_000;
export const MAX_SAMPLE_ASSET_EDGE = 12_000;
const MIN_SAMPLE_ASSET_EDGE = 32;
const RENDER_MAX_EDGE = 1_600;

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MIME_BY_FORMAT: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export class SampleMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SampleMediaError";
  }
}

function inside(parent: string, candidate: string): boolean {
  const rel = path.relative(parent, candidate);
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
}

export function sampleRequestRoot(requestId: string, workspace = workspaceRoot()): string {
  if (!SAFE_ID.test(requestId)) throw new SampleMediaError("不正なrequestIdです");
  return path.join(workspace, SAMPLE_DIRECTORY, requestId);
}

export function sampleInputDir(requestId: string, workspace = workspaceRoot()): string {
  return path.join(sampleRequestRoot(requestId, workspace), SAMPLE_INPUT_DIR);
}

export function sampleVersionDir(requestId: string, version: number, workspace = workspaceRoot()): string {
  if (!Number.isInteger(version) || version < 1 || version > 999) throw new SampleMediaError("不正なversionです");
  return path.join(sampleRequestRoot(requestId, workspace), `v${version}`);
}

export interface ResolvedFile {
  absolutePath: string;
  /** workspace相対(区切りは/) */
  safeRelativePath: string;
  source: Buffer;
  sha256: string;
  bytes: number;
}

/** workspace配下の画像ファイルを、指定ルート内に限定して安全に読む(同期・hash計算込み) */
function resolveWithin(rootDir: string, fileName: string, workspace: string, label: string): ResolvedFile {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.startsWith(".")) {
    throw new SampleMediaError(`${label}のファイル名が不正です: ${fileName}`);
  }
  if (!existsSync(rootDir)) throw new SampleMediaError(`${label}のフォルダが存在しません: ${path.relative(workspace, rootDir)}`);
  const lexical = path.resolve(rootDir, fileName);
  if (!inside(rootDir, lexical)) throw new SampleMediaError(`${label}が許可フォルダの外を参照しています(path traversal拒否)`);
  if (!existsSync(lexical)) throw new SampleMediaError(`${label}が存在しません: ${fileName}`);
  const realRoot = realpathSync(rootDir);
  const realFile = realpathSync(lexical);
  if (!inside(realRoot, realFile)) throw new SampleMediaError(`${label}のsymlinkが許可フォルダ外を参照しています`);
  if (!ALLOWED_EXTENSIONS.has(path.extname(realFile).toLowerCase())) throw new SampleMediaError(`${label}はPNG/JPEG/WebPのみ対応しています`);
  const st = statSync(realFile);
  if (!st.isFile()) throw new SampleMediaError(`${label}が通常ファイルではありません`);
  if (st.size <= 0 || st.size > MAX_SAMPLE_ASSET_BYTES) {
    throw new SampleMediaError(`${label}のサイズ上限は${MAX_SAMPLE_ASSET_BYTES / 1024 / 1024}MBです`);
  }
  const source = readFileSync(realFile);
  return {
    absolutePath: realFile,
    safeRelativePath: path.relative(realpathSync(workspace), realFile).split(path.sep).join("/"),
    source,
    sha256: createHash("sha256").update(source).digest("hex"),
    bytes: st.size,
  };
}

/** 代表者が投入した素材(input/配下) */
export function resolveSampleAssetFile(requestId: string, fileName: string, workspace = workspaceRoot()): ResolvedFile {
  return resolveWithin(sampleInputDir(requestId, workspace), fileName, workspace, "サンプル素材");
}

export interface InspectedImage extends ResolvedFile {
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

async function inspect(file: ResolvedFile, label: string): Promise<InspectedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(file.source, { failOn: "error", limitInputPixels: MAX_SAMPLE_ASSET_PIXELS }).metadata();
  } catch (error) {
    throw new SampleMediaError(`${label}を読み込めません: ${error instanceof Error ? error.message : String(error)}`);
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const mimeType = metadata.format ? MIME_BY_FORMAT[metadata.format] : undefined;
  if (!mimeType) throw new SampleMediaError(`${label}の実形式がPNG/JPEG/WebPではありません`);
  if (width < MIN_SAMPLE_ASSET_EDGE || height < MIN_SAMPLE_ASSET_EDGE) throw new SampleMediaError(`${label}が小さすぎます(${width}x${height})`);
  if (width > MAX_SAMPLE_ASSET_EDGE || height > MAX_SAMPLE_ASSET_EDGE * 4 || width * height > MAX_SAMPLE_ASSET_PIXELS) {
    throw new SampleMediaError(`${label}の解像度が上限を超えています(${width}x${height})`);
  }
  return { ...file, width, height, mimeType };
}

/** 素材を実デコードして寸法・形式まで検査する(DB登録前) */
export async function inspectSampleAsset(requestId: string, fileName: string, workspace = workspaceRoot()): Promise<InspectedImage> {
  return inspect(resolveSampleAssetFile(requestId, fileName, workspace), "サンプル素材");
}

/** 撮影PNG(v<n>/shots/<name>.png)。specに刻印したhashとの一致を必須にする */
export function resolveSampleScreenshotFile(ref: Pick<SampleScreenshotRef, "safeRelativePath" | "sha256">, workspace = workspaceRoot()): ResolvedFile {
  const rel = ref.safeRelativePath.replaceAll("\\", "/");
  const m = /^02_site-samples\/([A-Za-z0-9_-]{1,40})\/v(\d{1,3})\/shots\/([a-z-]+\.png)$/.exec(rel);
  if (!m) throw new SampleMediaError(`撮影画像のパスが不正です: ${ref.safeRelativePath}`);
  const dir = path.join(sampleVersionDir(m[1]!, Number(m[2]), workspace), SAMPLE_SHOTS_DIR);
  const file = resolveWithin(dir, m[3]!, workspace, "撮影画像");
  if (file.sha256 !== ref.sha256) throw new SampleMediaError("撮影画像がQA後に差し替えられています(hash不一致)。再ビルド・再QAが必要です");
  return file;
}

export interface ResolvedSampleScreenshot {
  ref: SampleScreenshotRef;
  /** 正規化済みPNG。spec/DBへは保存せず、レンダリング中だけ使用する */
  dataUri: string;
}

/** 撮影画像をレンダリング専用の安全なPNG data URIにする(白背景・sRGB・長辺1600px以内) */
export async function resolveSampleScreenshotMedia(ref: SampleScreenshotRef, workspace = workspaceRoot()): Promise<ResolvedSampleScreenshot> {
  const file = resolveSampleScreenshotFile(ref, workspace);
  const info = await inspect(file, "撮影画像");
  if (info.width !== ref.width || info.height !== ref.height) {
    throw new SampleMediaError(`撮影画像の寸法がspecと一致しません(${info.width}x${info.height} / spec ${ref.width}x${ref.height})`);
  }
  const normalized = await sharp(file.source, { failOn: "error", limitInputPixels: MAX_SAMPLE_ASSET_PIXELS })
    .flatten({ background: "#ffffff" })
    .resize({ width: RENDER_MAX_EDGE, height: RENDER_MAX_EDGE * 2, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb")
    .png()
    .toBuffer();
  return { ref, dataUri: `data:image/png;base64,${normalized.toString("base64")}` };
}

/** 撮影直後のPNGからspec用の参照(hash・寸法・相対パス)を作る */
export async function describeScreenshot(absolutePath: string, name: SampleScreenshotRef["name"], workspace = workspaceRoot()): Promise<SampleScreenshotRef> {
  const source = readFileSync(absolutePath);
  const meta = await sharp(source, { failOn: "error", limitInputPixels: MAX_SAMPLE_ASSET_PIXELS }).metadata();
  return {
    name,
    sha256: createHash("sha256").update(source).digest("hex"),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    safeRelativePath: path.relative(realpathSync(workspace), realpathSync(absolutePath)).split(path.sep).join("/"),
  };
}
