/**
 * 制作実績スクリーンショットの安全な解決・正規化。
 *
 * - 素材は workspace/04_portfolio-assets/<portfolioItemId>/ 配下だけを許可
 * - 絶対パス、path traversal、ルート外symlink、未対応形式、巨大画像を拒否
 * - DB/specには相対パス・元ファイルhash・寸法だけを記録し、画像本体は保存しない
 * - Satoriへ渡す直前だけ、Sharpで白背景・sRGB・PNGへ正規化したdata URIを作る
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { workspaceRoot } from "../root";
import type { PortfolioMedia } from "../../core/schemas";

export const PORTFOLIO_ASSET_DIRECTORY = "04_portfolio-assets";
export const MAX_PORTFOLIO_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_PORTFOLIO_ASSET_PIXELS = 50_000_000;
export const MAX_PORTFOLIO_ASSET_EDGE = 12_000;
const MIN_PORTFOLIO_ASSET_EDGE = 320;
const RENDER_MAX_EDGE = 1_600;

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MIME_BY_FORMAT: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export class PortfolioMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioMediaError";
  }
}

export interface PortfolioAssetFile {
  absolutePath: string;
  safeRelativePath: string;
  source: Buffer;
  assetSha256: string;
}

export interface ResolvedPortfolioMedia {
  meta: Extract<PortfolioMedia, { mode: "real_screenshot" }>;
  /** 正規化済みPNG。spec/DBへは保存せず、レンダリング中だけ使用する */
  dataUri: string;
}

function inside(parent: string, candidate: string): boolean {
  const rel = path.relative(parent, candidate);
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
}

function allowedExtension(file: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function chooseFile(candidate: string): string {
  const st = statSync(candidate);
  if (st.isFile()) return candidate;
  if (!st.isDirectory()) throw new PortfolioMediaError("実績素材は通常ファイルまたはフォルダを指定してください");
  const first = readdirSync(candidate, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && allowedExtension(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "ja"))[0];
  if (!first) throw new PortfolioMediaError("実績素材フォルダにPNG/JPEG/WebPがありません");
  return path.join(candidate, first);
}

/**
 * 同期で実行できるパス・サイズ・hash検査。承認/export時の再検査にも使用する。
 * 画像デコード検査は resolvePortfolioMedia() が追加で行う。
 */
export function resolvePortfolioAssetFile(
  portfolioItemId: string,
  assetsPath: string | null | undefined,
  workspace = workspaceRoot(),
): PortfolioAssetFile {
  if (!portfolioItemId || portfolioItemId.includes("/") || portfolioItemId.includes("\\")) {
    throw new PortfolioMediaError("不正なportfolioItemIdです");
  }
  if (!assetsPath?.trim()) throw new PortfolioMediaError("実績画像が登録されていません(assetsPathが空です)");
  const supplied = assetsPath.trim();
  if (path.isAbsolute(supplied)) throw new PortfolioMediaError("実績画像に絶対パスは使用できません");

  const root = path.join(workspace, PORTFOLIO_ASSET_DIRECTORY);
  const itemRoot = path.join(root, portfolioItemId);
  if (!existsSync(itemRoot)) throw new PortfolioMediaError(`実績画像フォルダが存在しません: ${PORTFOLIO_ASSET_DIRECTORY}/${portfolioItemId}`);
  const realWorkspace = realpathSync(workspace);

  const logicalPrefix = `${PORTFOLIO_ASSET_DIRECTORY}/${portfolioItemId}/`;
  const relative = supplied.replaceAll("\\", "/").startsWith(logicalPrefix)
    ? supplied.replaceAll("\\", "/").slice(logicalPrefix.length)
    : supplied;
  if (!relative || relative === ".") throw new PortfolioMediaError("実績画像のファイル名またはフォルダ名が必要です");

  const lexicalCandidate = path.resolve(itemRoot, relative);
  if (!inside(itemRoot, lexicalCandidate)) {
    throw new PortfolioMediaError("実績画像が許可フォルダの外を参照しています(path traversal拒否)");
  }
  if (!existsSync(lexicalCandidate)) throw new PortfolioMediaError(`実績画像が存在しません: ${relative}`);

  const chosen = chooseFile(lexicalCandidate);
  const realItemRoot = realpathSync(itemRoot);
  const realFile = realpathSync(chosen);
  if (!inside(realItemRoot, realFile)) {
    throw new PortfolioMediaError("実績画像のsymlinkが許可フォルダ外を参照しています");
  }
  if (!allowedExtension(realFile)) throw new PortfolioMediaError("実績画像はPNG/JPEG/WebPのみ対応しています");

  const st = statSync(realFile);
  if (!st.isFile()) throw new PortfolioMediaError("実績素材が通常ファイルではありません");
  if (st.size <= 0 || st.size > MAX_PORTFOLIO_ASSET_BYTES) {
    throw new PortfolioMediaError(`実績画像のサイズ上限は${MAX_PORTFOLIO_ASSET_BYTES / 1024 / 1024}MBです`);
  }
  const source = readFileSync(realFile);
  const safeRelativePath = path.relative(realWorkspace, realFile).split(path.sep).join("/");
  return {
    absolutePath: realFile,
    safeRelativePath,
    source,
    assetSha256: createHash("sha256").update(source).digest("hex"),
  };
}

/** 画像を実デコードし、レンダリング専用の安全なPNG data URIを作る。 */
export async function resolvePortfolioMedia(
  portfolioItemId: string,
  assetsPath: string | null | undefined,
  workspace = workspaceRoot(),
): Promise<ResolvedPortfolioMedia> {
  const file = resolvePortfolioAssetFile(portfolioItemId, assetsPath, workspace);
  let metadata: Metadata;
  try {
    metadata = await sharp(file.source, { failOn: "error", limitInputPixels: MAX_PORTFOLIO_ASSET_PIXELS }).metadata();
  } catch (error) {
    throw new PortfolioMediaError(`実績画像を読み込めません: ${error instanceof Error ? error.message : String(error)}`);
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const mimeType = metadata.format ? MIME_BY_FORMAT[metadata.format] : undefined;
  if (!mimeType) throw new PortfolioMediaError("画像の実形式がPNG/JPEG/WebPではありません");
  if (width < MIN_PORTFOLIO_ASSET_EDGE || height < MIN_PORTFOLIO_ASSET_EDGE) {
    throw new PortfolioMediaError(`実績画像が小さすぎます(${width}x${height}、各辺${MIN_PORTFOLIO_ASSET_EDGE}px以上が必要)`);
  }
  if (width > MAX_PORTFOLIO_ASSET_EDGE || height > MAX_PORTFOLIO_ASSET_EDGE || width * height > MAX_PORTFOLIO_ASSET_PIXELS) {
    throw new PortfolioMediaError(`実績画像の解像度が上限を超えています(${width}x${height})`);
  }

  const normalized = await sharp(file.source, { failOn: "error", limitInputPixels: MAX_PORTFOLIO_ASSET_PIXELS })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: RENDER_MAX_EDGE, height: RENDER_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb")
    .png()
    .toBuffer();

  return {
    meta: {
      mode: "real_screenshot",
      assetSha256: file.assetSha256,
      mimeType,
      width,
      height,
      safeRelativePath: file.safeRelativePath,
    },
    dataUri: `data:image/png;base64,${normalized.toString("base64")}`,
  };
}
