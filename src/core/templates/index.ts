/**
 * テンプレートレジストリ(V3-D)。
 * テンプレートIDから通常コードでレンダラー・スロット・期待ページ数を解決する。
 * CLIやレンダラーにテンプレート分岐を直書きしない。
 */
import type { CarouselSpec, TemplateId } from "../schemas";
import { TEMPLATE_IDS } from "../schemas";
import type { BrandColors, SatoriNode, SlotText } from "./shared";
import { enumerateSlots as howtoSlots, buildPages as howtoPages, expectedPageCount as howtoExpected } from "./tpl-howto";
import { enumerateNewsSlots, buildNewsPages, expectedNewsPages } from "./tpl-news";
import { enumeratePortfolioSlots, buildPortfolioPages, expectedPortfolioPages } from "./tpl-portfolio";

export type CopyKind = "copy" | "news_copy" | "portfolio_copy";

export interface TemplateDef {
  id: TemplateId;
  /** このテンプレートが入力にするコピー成果物のkind */
  copyKind: CopyKind;
  enumerateSlots(spec: CarouselSpec): SlotText[];
  buildPages(spec: CarouselSpec, colors: BrandColors): SatoriNode[];
  expectedPages(spec: CarouselSpec): number;
}

function narrow<T extends CarouselSpec["templateId"]>(spec: CarouselSpec, id: T): Extract<CarouselSpec, { templateId: T }> {
  if (spec.templateId !== id) throw new Error(`テンプレート不一致: 期待${id}, 実際${spec.templateId}`);
  return spec as Extract<CarouselSpec, { templateId: T }>;
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  "tpl-howto": {
    id: "tpl-howto",
    copyKind: "copy",
    enumerateSlots: (spec) => howtoSlots(narrow(spec, "tpl-howto")),
    buildPages: (spec, colors) => howtoPages(narrow(spec, "tpl-howto"), colors),
    expectedPages: (spec) => howtoExpected(narrow(spec, "tpl-howto")),
  },
  "tpl-news": {
    id: "tpl-news",
    copyKind: "news_copy",
    enumerateSlots: (spec) => enumerateNewsSlots(narrow(spec, "tpl-news")),
    buildPages: (spec, colors) => buildNewsPages(narrow(spec, "tpl-news"), colors),
    expectedPages: (spec) => expectedNewsPages(narrow(spec, "tpl-news")),
  },
  "tpl-portfolio": {
    id: "tpl-portfolio",
    copyKind: "portfolio_copy",
    enumerateSlots: (spec) => enumeratePortfolioSlots(narrow(spec, "tpl-portfolio")),
    buildPages: (spec, colors) => buildPortfolioPages(narrow(spec, "tpl-portfolio"), colors),
    expectedPages: (spec) => expectedPortfolioPages(narrow(spec, "tpl-portfolio")),
  },
};

export function templateFor(id: string): TemplateDef {
  const tpl = (TEMPLATES as Record<string, TemplateDef>)[id];
  if (!tpl) throw new Error(`不明なテンプレートID: ${id}(有効: ${TEMPLATE_IDS.join(", ")})`);
  return tpl;
}
