/**
 * カルーセルレンダラー(docs/11 D-09)。Satori(JSX→SVG)+Sharp(SVG→PNG 1080×1350)。
 * 通常コード — AIを使わない(確定§19)。同一spec+同一トークンからは同一PNGが生成される。
 *
 * 文字あふれ検査(3層のうち第2層):
 *   各スロットをSatoriの自動高さ(heightを渡さない)で実測し、SlotDef.maxHeightと比較する。
 *   超過があればレンダリングせず OverflowError を投げる(→琴葉への短縮タスク生成は呼び出し側)。
 */
import satori from "satori";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { CarouselSpec } from "../../core/schemas";
import { templateFor, type TemplateRenderAssets } from "../../core/templates/index";
import { CANVAS, type SatoriNode } from "../../core/templates/components";
import { loadFonts } from "./fonts";
import { loadTheme } from "./theme";
import { computeFingerprint } from "./fingerprint";

export interface SlotOverflow {
  slotPath: string;
  measuredHeight: number;
  maxHeight: number;
  text: string;
}

export class OverflowError extends Error {
  constructor(public readonly overflows: SlotOverflow[]) {
    super(
      `文字あふれを検出: ${overflows
        .map((o) => `${o.slotPath}(${Math.ceil(o.measuredHeight)}px > ${o.maxHeight}px)`)
        .join(", ")}`,
    );
    this.name = "OverflowError";
  }
}

const svgHeightRe = /<svg[^>]*\bheight="([\d.]+)"/;

/** スロット単位のSatori実測。heightを指定せず自動高さを取得して上限と比較する(全テンプレート共通) */
export async function measureSlotOverflows(spec: CarouselSpec): Promise<SlotOverflow[]> {
  const fonts = loadFonts();
  const overflows: SlotOverflow[] = [];
  const template = templateFor(spec.templateId);
  for (const slot of template.enumerateSlots(spec)) {
    const node: SatoriNode = {
      type: "div",
      props: {
        style: {
          width: slot.def.width,
          fontSize: slot.def.fontSize,
          lineHeight: slot.def.lineHeight,
          fontWeight: slot.def.weight,
          fontFamily: "Noto Sans JP",
          display: "flex",
          whiteSpace: "pre-wrap", // テンプレートと同一条件で改行を反映して実測する
        },
        children: slot.text,
      },
    };
    // eslint-disable-next-line no-await-in-loop
    const svg = await satori(node as never, { width: slot.def.width, fonts } as never);
    const m = svgHeightRe.exec(svg);
    const height = m?.[1] ? Number(m[1]) : Number.NaN;
    if (!Number.isFinite(height)) {
      throw new Error(`スロット高さの実測に失敗: ${slot.slotPath}`);
    }
    if (height > slot.def.maxHeight) {
      overflows.push({ slotPath: slot.slotPath, measuredHeight: height, maxHeight: slot.def.maxHeight, text: slot.text });
    }
  }
  return overflows;
}

export interface RenderResult {
  files: string[]; // 書き出したPNGの絶対パス(ページ順)
  pageCount: number;
  templateId: string;
  variant: string;
  /** 各ページのlayoutId(variant差分の構造判定に使う) */
  layoutIds: string[];
  /** 各ページPNGのSHA-256(variant差分の画像ハッシュ判定に使う) */
  pageHashes: string[];
  /** レンダリングに使ったテンプレート版のfingerprint(版承認・整合チェックの根拠) */
  fingerprint: string;
  /** 実績画像を埋め込んだ場合の元素材hash。specとの一致をdesign QAで検査する */
  embeddedAssetSha256?: string;
}

/**
 * カルーセル一式をPNGへレンダリング。事前にmeasureSlotOverflowsで検査し、超過時はOverflowError。
 * templateVersion はfingerprint算出に使う(既定=1。版管理は呼び出し側が指定)。
 */
export async function renderCarousel(
  spec: CarouselSpec,
  outDir: string,
  opts: { templateVersion?: number; assets?: TemplateRenderAssets } = {},
): Promise<RenderResult> {
  const overflows = await measureSlotOverflows(spec);
  if (overflows.length > 0) throw new OverflowError(overflows);

  const fonts = loadFonts();
  const theme = loadTheme();
  const template = templateFor(spec.templateId);
  const variant = template.pickVariant(spec);
  const templateVersion = opts.templateVersion ?? 1;
  const fingerprint = computeFingerprint(spec.templateId, templateVersion, theme);
  if (spec.templateId === "tpl-portfolio" && spec.portfolioMedia.mode === "real_screenshot") {
    if (!opts.assets?.portfolioImageDataUri) throw new Error("実績画像本体がレンダラーへ安全に引き渡されていません");
    if (opts.assets.portfolioAssetSha256 !== spec.portfolioMedia.assetSha256) {
      throw new Error("実績画像のhashがspecと一致しません(差し替えまたは不正な素材)");
    }
  }
  const pages = template.buildPages(spec, theme, variant, opts.assets);
  if (pages.length !== template.expectedPages(spec)) {
    throw new Error(`ページ数が期待値と不一致: ${pages.length} / ${template.expectedPages(spec)}`);
  }
  mkdirSync(outDir, { recursive: true });

  const files: string[] = [];
  const layoutIds: string[] = [];
  const pageHashes: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const svg = await satori(pages[i]!.node as never, { width: CANVAS.width, height: CANVAS.height, fonts } as never);
    // eslint-disable-next-line no-await-in-loop
    const png = await sharp(Buffer.from(svg))
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb")
      .png()
      .toBuffer();
    // eslint-disable-next-line no-await-in-loop
    const meta = await sharp(png).metadata();
    if (meta.width !== CANVAS.width || meta.height !== CANVAS.height) {
      throw new Error(`出力解像度が不正: ${meta.width}x${meta.height}(期待: ${CANVAS.width}x${CANVAS.height})`);
    }
    const file = path.join(outDir, `${String(i + 1).padStart(2, "0")}.png`);
    writeFileSync(file, png);
    files.push(file);
    layoutIds.push(pages[i]!.layoutId);
    pageHashes.push(createHash("sha256").update(png).digest("hex"));
  }
  return {
    files,
    pageCount: pages.length,
    templateId: spec.templateId,
    variant,
    layoutIds,
    pageHashes,
    fingerprint,
    ...(spec.templateId === "tpl-portfolio" && spec.portfolioMedia.mode === "real_screenshot"
      ? { embeddedAssetSha256: spec.portfolioMedia.assetSha256 }
      : {}),
  };
}
