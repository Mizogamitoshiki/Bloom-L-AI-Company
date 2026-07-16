/**
 * テンプレートレジストリ(V4.5 v3)。テンプレートID→系統モジュールを通常コードで解決する。
 * 各系統は2つのlayout variantを持ち、承認候補の2variantは本文でも異なるlayoutId(構造)を持つ。
 * buildPagesは各ページのlayoutIdを含むRenderedPage[]を返す。
 */
import type { CarouselSpec, TemplateId } from "../schemas";
import { TEMPLATE_IDS } from "../schemas";
import type { SlotText, RenderedPage } from "./components";
import type { Theme } from "./design-system";
import * as howto from "./tpl-howto";
import * as news from "./tpl-news";
import * as portfolio from "./tpl-portfolio";
import * as compare from "./tpl-compare";

export type CopyKind = "copy" | "news_copy" | "portfolio_copy" | "compare_copy";

/** DBへ保存しない、レンダリング中だけ有効な検証済み素材。 */
export interface TemplateRenderAssets {
  portfolioImageDataUri?: string;
  portfolioAssetSha256?: string;
}

export interface TemplateDef {
  id: TemplateId;
  family: string;
  copyKind: CopyKind;
  variants: readonly string[];
  pickVariant(spec: CarouselSpec): string;
  enumerateSlots(spec: CarouselSpec): SlotText[];
  buildPages(spec: CarouselSpec, theme: Theme, variant?: string, assets?: TemplateRenderAssets): RenderedPage[];
  layoutIds(spec: CarouselSpec, variant: string): string[];
  expectedPages(spec: CarouselSpec): number;
}

function narrow<T extends CarouselSpec["templateId"]>(spec: CarouselSpec, id: T): Extract<CarouselSpec, { templateId: T }> {
  if (spec.templateId !== id) throw new Error(`テンプレート不一致: 期待${id}, 実際${spec.templateId}`);
  return spec as Extract<CarouselSpec, { templateId: T }>;
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  "tpl-howto": {
    id: "tpl-howto", family: "education/howto", copyKind: "copy", variants: howto.VARIANTS,
    pickVariant: (spec) => howto.pickVariant(narrow(spec, "tpl-howto")),
    enumerateSlots: (spec) => howto.enumerateSlots(narrow(spec, "tpl-howto")),
    buildPages: (spec, theme, variant) => howto.buildPages(narrow(spec, "tpl-howto"), theme, variant as howto.HowtoVariant),
    layoutIds: (spec, variant) => howto.layoutIds(narrow(spec, "tpl-howto"), variant as howto.HowtoVariant),
    expectedPages: (spec) => howto.expectedPages(narrow(spec, "tpl-howto")),
  },
  "tpl-news": {
    id: "tpl-news", family: "news/insight", copyKind: "news_copy", variants: news.VARIANTS,
    pickVariant: (spec) => news.pickVariant(narrow(spec, "tpl-news")),
    enumerateSlots: (spec) => news.enumerateSlots(narrow(spec, "tpl-news")),
    buildPages: (spec, theme, variant) => news.buildPages(narrow(spec, "tpl-news"), theme, variant as news.NewsVariant),
    layoutIds: (spec, variant) => news.layoutIds(narrow(spec, "tpl-news"), variant as news.NewsVariant),
    expectedPages: () => news.expectedPages(),
  },
  "tpl-portfolio": {
    id: "tpl-portfolio", family: "portfolio/case-study", copyKind: "portfolio_copy", variants: portfolio.VARIANTS,
    pickVariant: (spec) => portfolio.pickVariant(narrow(spec, "tpl-portfolio")),
    enumerateSlots: (spec) => portfolio.enumerateSlots(narrow(spec, "tpl-portfolio")),
    buildPages: (spec, theme, variant, assets) => portfolio.buildPages(narrow(spec, "tpl-portfolio"), theme, variant as portfolio.PortfolioVariant, assets),
    layoutIds: (spec, variant) => portfolio.layoutIds(narrow(spec, "tpl-portfolio"), variant as portfolio.PortfolioVariant),
    expectedPages: () => portfolio.expectedPages(),
  },
  "tpl-compare": {
    id: "tpl-compare", family: "comparison/checklist", copyKind: "compare_copy", variants: compare.VARIANTS,
    pickVariant: (spec) => compare.pickVariant(narrow(spec, "tpl-compare")),
    enumerateSlots: (spec) => compare.enumerateSlots(narrow(spec, "tpl-compare")),
    buildPages: (spec, theme, variant) => compare.buildPages(narrow(spec, "tpl-compare"), theme, variant as compare.CompareVariant),
    layoutIds: (spec, variant) => compare.layoutIds(narrow(spec, "tpl-compare"), variant as compare.CompareVariant),
    expectedPages: () => compare.expectedPages(),
  },
};

export function templateFor(id: string): TemplateDef {
  const tpl = (TEMPLATES as Record<string, TemplateDef>)[id];
  if (!tpl) throw new Error(`不明なテンプレートID: ${id}(有効: ${TEMPLATE_IDS.join(", ")})`);
  return tpl;
}
