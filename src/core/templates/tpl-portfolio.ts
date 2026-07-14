/**
 * tpl-portfolio: HP制作実績紹介(柱⑤)。V3-D。
 * 構成(5ページ固定): 表紙 → 課題 → 対応 → 成果 → 使用技術+CTA。
 * displayName(顧客名/匿名名)は許可状態から通常コードが注入する(AIは顧客名を書かない)。
 * customer_permissionsがapproved以外の実名利用はレンダリング前に拒否される(render-post)。
 */
import type { PortfolioSpec } from "../schemas";
import {
  CONTENT_WIDTH,
  type BrandColors,
  type SatoriNode,
  type SlotDef,
  type SlotText,
  el,
  textSlot,
  frame,
  brandBar,
  pageDots,
  centerColumn,
  sectionTag,
  PILLAR_LABEL,
} from "./shared";

export const PORTFOLIO_SLOTS = {
  coverTitle: { id: "cover.title", width: CONTENT_WIDTH, fontSize: 72, lineHeight: 1.35, weight: 700, maxHeight: 400 },
  coverSubtitle: { id: "cover.subtitle", width: CONTENT_WIDTH, fontSize: 40, lineHeight: 1.5, weight: 400, maxHeight: 130 },
  sectionHeading: { id: "section.heading", width: CONTENT_WIDTH, fontSize: 52, lineHeight: 1.3, weight: 700, maxHeight: 140 },
  sectionBody: { id: "section.body", width: CONTENT_WIDTH, fontSize: 40, lineHeight: 1.75, weight: 400, maxHeight: 560 },
  techItem: { id: "tech.items[i]", width: 420, fontSize: 32, lineHeight: 1.4, weight: 700, maxHeight: 100 },
  ctaMessage: { id: "cta.message", width: CONTENT_WIDTH, fontSize: 50, lineHeight: 1.5, weight: 700, maxHeight: 240 },
} as const satisfies Record<string, SlotDef>;

export function enumeratePortfolioSlots(spec: PortfolioSpec): SlotText[] {
  const s: SlotText[] = [{ def: PORTFOLIO_SLOTS.coverTitle, slotPath: "cover.title", text: spec.slides.cover.title }];
  if (spec.slides.cover.subtitle) {
    s.push({ def: PORTFOLIO_SLOTS.coverSubtitle, slotPath: "cover.subtitle", text: spec.slides.cover.subtitle });
  }
  for (const key of ["challenge", "approach", "result"] as const) {
    s.push({ def: PORTFOLIO_SLOTS.sectionHeading, slotPath: `${key}.heading`, text: spec.slides[key].heading });
    s.push({ def: PORTFOLIO_SLOTS.sectionBody, slotPath: `${key}.body`, text: spec.slides[key].body });
  }
  spec.slides.tech.items.forEach((t, i) =>
    s.push({ def: PORTFOLIO_SLOTS.techItem, slotPath: `tech.items[${i}]`, text: t }),
  );
  s.push({ def: PORTFOLIO_SLOTS.ctaMessage, slotPath: "cta.message", text: spec.slides.ctaMessage });
  return s;
}

export function expectedPortfolioPages(_spec: PortfolioSpec): number {
  return 5;
}

const SECTION_LABEL = { challenge: "課題", approach: "Bloom-Lの対応", result: "成果" } as const;

export function buildPortfolioPages(spec: PortfolioSpec, colors: BrandColors): SatoriNode[] {
  const total = 5;
  const pillar = PILLAR_LABEL[spec.pillar];
  const nameLine = spec.anonymous ? `${spec.displayName}(匿名事例)` : `${spec.displayName} さま`;

  const cover = frame(colors, [
    brandBar(colors, pillar),
    centerColumn(
      [
        sectionTag(colors, "制作実績", colors.accent),
        textSlot(PORTFOLIO_SLOTS.coverTitle, spec.slides.cover.title),
        el("div", { fontSize: 36, fontWeight: 700, color: colors.primaryDark, display: "flex" }, nameLine),
        ...(spec.slides.cover.subtitle
          ? [textSlot(PORTFOLIO_SLOTS.coverSubtitle, spec.slides.cover.subtitle, { color: colors.inkMuted })]
          : []),
      ],
      32,
    ),
    pageDots(colors, total, 0),
  ]);

  const sections = (["challenge", "approach", "result"] as const).map((key, idx) =>
    frame(colors, [
      brandBar(colors, pillar),
      centerColumn([
        sectionTag(colors, SECTION_LABEL[key]),
        textSlot(PORTFOLIO_SLOTS.sectionHeading, spec.slides[key].heading),
        textSlot(PORTFOLIO_SLOTS.sectionBody, spec.slides[key].body),
      ]),
      pageDots(colors, total, idx + 1),
    ]),
  );

  const ctaPage = frame(colors, [
    brandBar(colors, pillar),
    centerColumn(
      [
        sectionTag(colors, "使用技術"),
        el(
          "div",
          { display: "flex", flexWrap: "wrap", gap: 16 },
          spec.slides.tech.items.map((t) =>
            el(
              "div",
              {
                border: `3px solid ${colors.primary}`,
                color: colors.primaryDark,
                fontSize: 32,
                fontWeight: 700,
                padding: "10px 24px",
                borderRadius: 10,
                display: "flex",
              },
              t,
            ),
          ),
        ),
        textSlot(PORTFOLIO_SLOTS.ctaMessage, spec.slides.ctaMessage, { textAlign: "center", alignSelf: "center", marginTop: 24 }),
        el(
          "div",
          {
            backgroundColor: colors.primary,
            color: "#ffffff",
            fontSize: 40,
            fontWeight: 700,
            padding: "24px 48px",
            borderRadius: 12,
            display: "flex",
            alignSelf: "center",
          },
          "DMで「相談」とお送りください",
        ),
      ],
      36,
    ),
    pageDots(colors, total, 4),
  ]);

  return [cover, ...sections, ctaPage];
}
