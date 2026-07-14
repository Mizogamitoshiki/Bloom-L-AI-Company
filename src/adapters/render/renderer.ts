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
import path from "node:path";
import type { CarouselSpec } from "../../core/schemas";
import { templateFor } from "../../core/templates/index";
import { CANVAS, type BrandColors, type SatoriNode } from "../../core/templates/shared";
import { loadFonts } from "./fonts";
import { loadBrandTokens } from "../config";

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

function brandColors(): BrandColors {
  const tokens = loadBrandTokens();
  const c = tokens.colors;
  return {
    primary: c.primary ?? "#2f6f4f",
    primaryDark: c.primaryDark ?? "#1e4a34",
    accent: c.accent ?? "#e8a13a",
    surface: c.surface ?? "#f6f3ec",
    ink: c.ink ?? "#22281f",
    inkMuted: c.inkMuted ?? "#5c6357",
  };
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
}

/** カルーセル一式をPNGへレンダリング。事前にmeasureSlotOverflowsで検査し、超過時はOverflowError */
export async function renderCarousel(spec: CarouselSpec, outDir: string): Promise<RenderResult> {
  const overflows = await measureSlotOverflows(spec);
  if (overflows.length > 0) throw new OverflowError(overflows);

  const fonts = loadFonts();
  const colors = brandColors();
  const template = templateFor(spec.templateId);
  const pages = template.buildPages(spec, colors);
  if (pages.length !== template.expectedPages(spec)) {
    throw new Error(`ページ数が期待値と不一致: ${pages.length} / ${template.expectedPages(spec)}`);
  }
  mkdirSync(outDir, { recursive: true });

  const files: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const svg = await satori(pages[i] as never, { width: CANVAS.width, height: CANVAS.height, fonts } as never);
    // eslint-disable-next-line no-await-in-loop
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    // eslint-disable-next-line no-await-in-loop
    const meta = await sharp(png).metadata();
    if (meta.width !== CANVAS.width || meta.height !== CANVAS.height) {
      throw new Error(`出力解像度が不正: ${meta.width}x${meta.height}(期待: ${CANVAS.width}x${CANVAS.height})`);
    }
    const file = path.join(outDir, `${String(i + 1).padStart(2, "0")}.png`);
    writeFileSync(file, png);
    files.push(file);
  }
  return { files, pageCount: pages.length };
}
