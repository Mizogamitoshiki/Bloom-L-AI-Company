/**
 * design QA(V4.5)。レンダリング済み全PNGとspecから、通常コードが決定的に判定する(AI不使用)。
 * content QA(誤字・禁止語・権利)とは分離。ここは寸法・ページ数・画像順・ロゴ・token/版整合を見る。
 * 未登録色やセーフエリア違反はcomponent層(design-system)が構造的に防ぐため、
 * ここでは「design-systemで生成されたこと(fingerprint)」と「出力の物理的健全性」を検証する。
 */
import sharp from "sharp";
import path from "node:path";
import { existsSync } from "node:fs";
import type { CarouselSpec, DesignQaResult } from "../../core/schemas";
import { CANVAS } from "../../core/templates/design-system";
import { templateFor } from "../../core/templates/index";
import { loadTheme } from "./theme";
import { computeFingerprint } from "./fingerprint";
import type { Theme } from "../../core/templates/design-system";

interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

export interface RenderInfo {
  files: string[];
  pageCount: number;
  variant: string;
  fingerprint: string;
  templateVersion: number;
  embeddedAssetSha256?: string;
}

/** 全PNGとspecからdesign QAを判定する */
export async function runDesignQa(spec: CarouselSpec, render: RenderInfo, theme: Theme = loadTheme()): Promise<DesignQaResult> {
  const checks: Check[] = [];
  const tpl = templateFor(spec.templateId);
  const expected = tpl.expectedPages(spec);

  // 1. ページ数(表紙+本文+CTAで5〜7枚)
  const inRange = render.pageCount >= 5 && render.pageCount <= 7;
  checks.push({ id: "page-count", ok: render.pageCount === expected && inRange, detail: `${render.pageCount}枚(期待${expected}・目標5〜7)` });

  // 2. 画像の連番と実在
  let filesOk = render.files.length === render.pageCount;
  for (let i = 0; i < render.files.length; i++) {
    const expectName = `${String(i + 1).padStart(2, "0")}.png`;
    if (path.basename(render.files[i]!) !== expectName || !existsSync(render.files[i]!)) filesOk = false;
  }
  checks.push({ id: "image-sequence", ok: filesOk, detail: filesOk ? "01.png..連番で実在" : "画像の連番/実在に不整合" });

  // 3. 全ページ 1080×1350(4:5)
  let dimsOk = true;
  let physicalOk = true;
  const badDims: string[] = [];
  const badPhysical: string[] = [];
  for (const f of render.files) {
    // eslint-disable-next-line no-await-in-loop
    const m = existsSync(f) ? await sharp(f).metadata() : null;
    if (m?.width !== CANVAS.width || m?.height !== CANVAS.height) {
      dimsOk = false;
      badDims.push(`${path.basename(f)}=${m?.width ?? 0}x${m?.height ?? 0}`);
    }
    // eslint-disable-next-line no-await-in-loop
    const stats = existsSync(f) ? await sharp(f).stats() : null;
    if (m?.space !== "srgb" || m?.channels !== 3 || stats?.isOpaque !== true) {
      physicalOk = false;
      badPhysical.push(`${path.basename(f)}=${m?.space ?? "?"}/${m?.channels ?? "?"}ch/opaque:${stats?.isOpaque ?? false}`);
    }
  }
  checks.push({ id: "dimensions", ok: dimsOk, detail: dimsOk ? `全ページ${CANVAS.width}x${CANVAS.height}` : `寸法違反: ${badDims.join(", ")}` });
  checks.push({ id: "opaque-srgb", ok: physicalOk, detail: physicalOk ? "全ページsRGB・3ch・完全不透明" : `画像物理形式違反: ${badPhysical.join(", ")}` });

  // 4. 実ロゴの使用(brand manifestのロゴが埋め込まれている)
  checks.push({ id: "logo", ok: theme.logo !== null, detail: theme.logo ? "実ロゴを使用" : "実ロゴ未検出(文字代用は不可)" });

  // 5. テンプレート版fingerprintの整合(design-systemで生成されたこと)
  const currentFp = computeFingerprint(spec.templateId, render.templateVersion, theme);
  const fpOk = render.fingerprint === currentFp;
  checks.push({ id: "fingerprint", ok: fpOk, detail: fpOk ? "現行design-systemと一致" : "fingerprint不一致(旧版/改変の可能性)" });

  // 6. layout variantが承認可能な集合内
  const variantOk = tpl.variants.includes(render.variant);
  checks.push({ id: "variant", ok: variantOk, detail: variantOk ? `variant=${render.variant}` : `未登録variant=${render.variant}` });

  // 7. portfolio showcaseは許可済み実画像を必須とし、specと実際に埋め込んだ素材hashを照合する
  if (spec.templateId === "tpl-portfolio") {
    const media = spec.portfolioMedia;
    const isReal = media.mode === "real_screenshot";
    const mediaOk = render.variant !== "showcase"
      ? (!isReal || render.embeddedAssetSha256 === media.assetSha256)
      : isReal && render.embeddedAssetSha256 === media.assetSha256;
    checks.push({
      id: "portfolio-media",
      ok: mediaOk,
      detail: mediaOk
        ? (isReal ? `許可済み実画像hash一致(${media.assetSha256.slice(0, 12)}…)` : "story abstract(実画像未使用)")
        : "showcaseの実画像が未設定、または埋め込み素材hashがspecと不一致",
    });
  }

  const failures = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
  return {
    kind: "design_qa",
    result: failures.length === 0 ? "pass" : "fail",
    templateId: spec.templateId,
    templateVersion: render.templateVersion,
    variant: render.variant,
    fingerprint: render.fingerprint,
    pageCount: render.pageCount,
    checks,
    failures,
  };
}
