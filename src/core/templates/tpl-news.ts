/**
 * tpl-news: IT・AIニュース解説(柱①④)。V3-D。
 * 構成(5ページ固定): 表紙 → 事実 → Bloom-Lの見解 → 事業者への影響 → 出典+CTA。
 * 事実(facts)と見解(opinion)をページ・ラベルで明確に分離する(docs/15)。
 * 出典はDB登録済みsourcesから通常コードが注入する(spec.sourceRefs)。
 */
import type { NewsSpec } from "../schemas";
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

export const NEWS_SLOTS = {
  coverTitle: { id: "cover.title", width: CONTENT_WIDTH, fontSize: 72, lineHeight: 1.35, weight: 700, maxHeight: 400 },
  coverSubtitle: { id: "cover.subtitle", width: CONTENT_WIDTH, fontSize: 40, lineHeight: 1.5, weight: 400, maxHeight: 130 },
  factText: { id: "facts[i].text", width: CONTENT_WIDTH - 60, fontSize: 36, lineHeight: 1.6, weight: 400, maxHeight: 180 },
  sectionHeading: { id: "section.heading", width: CONTENT_WIDTH, fontSize: 52, lineHeight: 1.3, weight: 700, maxHeight: 140 },
  sectionBody: { id: "section.body", width: CONTENT_WIDTH, fontSize: 40, lineHeight: 1.75, weight: 400, maxHeight: 560 },
  ctaMessage: { id: "cta.message", width: CONTENT_WIDTH, fontSize: 50, lineHeight: 1.5, weight: 700, maxHeight: 240 },
} as const satisfies Record<string, SlotDef>;

export function enumerateNewsSlots(spec: NewsSpec): SlotText[] {
  const s: SlotText[] = [{ def: NEWS_SLOTS.coverTitle, slotPath: "cover.title", text: spec.slides.cover.title }];
  if (spec.slides.cover.subtitle) {
    s.push({ def: NEWS_SLOTS.coverSubtitle, slotPath: "cover.subtitle", text: spec.slides.cover.subtitle });
  }
  spec.slides.facts.forEach((f, i) => s.push({ def: NEWS_SLOTS.factText, slotPath: `facts[${i}].text`, text: f.text }));
  s.push({ def: NEWS_SLOTS.sectionHeading, slotPath: "opinion.heading", text: spec.slides.opinion.heading });
  s.push({ def: NEWS_SLOTS.sectionBody, slotPath: "opinion.body", text: spec.slides.opinion.body });
  s.push({ def: NEWS_SLOTS.sectionHeading, slotPath: "impact.heading", text: spec.slides.impact.heading });
  s.push({ def: NEWS_SLOTS.sectionBody, slotPath: "impact.body", text: spec.slides.impact.body });
  s.push({ def: NEWS_SLOTS.ctaMessage, slotPath: "cta.message", text: spec.slides.ctaMessage });
  return s;
}

export function expectedNewsPages(_spec: NewsSpec): number {
  return 5;
}

function sectionPage(
  colors: BrandColors,
  tag: string,
  tagBg: string | undefined,
  heading: string,
  body: string,
  total: number,
  current: number,
  pillar: NewsSpec["pillar"],
): SatoriNode {
  return frame(colors, [
    brandBar(colors, PILLAR_LABEL[pillar]),
    centerColumn([
      sectionTag(colors, tag, tagBg),
      textSlot(NEWS_SLOTS.sectionHeading, heading),
      textSlot(NEWS_SLOTS.sectionBody, body),
    ]),
    pageDots(colors, total, current),
  ]);
}

export function buildNewsPages(spec: NewsSpec, colors: BrandColors): SatoriNode[] {
  const total = 5;
  const pillar = PILLAR_LABEL[spec.pillar];

  const cover = frame(colors, [
    brandBar(colors, pillar),
    centerColumn(
      [
        sectionTag(colors, "ニュース解説", colors.accent),
        textSlot(NEWS_SLOTS.coverTitle, spec.slides.cover.title),
        ...(spec.slides.cover.subtitle
          ? [textSlot(NEWS_SLOTS.coverSubtitle, spec.slides.cover.subtitle, { color: colors.inkMuted })]
          : []),
      ],
      36,
    ),
    pageDots(colors, total, 0),
  ]);

  const facts = frame(colors, [
    brandBar(colors, pillar),
    centerColumn(
      [
        sectionTag(colors, "事実(報道内容)"),
        ...spec.slides.facts.map((f, i) =>
          el("div", { display: "flex", gap: 20, alignItems: "flex-start" }, [
            el(
              "div",
              {
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.primary,
                color: "#fff",
                fontSize: 24,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              },
              String(i + 1),
            ),
            textSlot(NEWS_SLOTS.factText, f.text),
          ]),
        ),
      ],
      32,
    ),
    pageDots(colors, total, 1),
  ]);

  const opinion = sectionPage(
    colors,
    "Bloom-Lの見解(事実と区別してお読みください)",
    colors.accent,
    spec.slides.opinion.heading,
    spec.slides.opinion.body,
    total,
    2,
    spec.pillar,
  );
  const impact = sectionPage(colors, "事業者への影響", undefined, spec.slides.impact.heading, spec.slides.impact.body, total, 3, spec.pillar);

  const ctaPage = frame(colors, [
    brandBar(colors, pillar),
    centerColumn(
      [
        textSlot(NEWS_SLOTS.ctaMessage, spec.slides.ctaMessage, { textAlign: "center", alignSelf: "center" }),
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
        el(
          "div",
          { display: "flex", flexDirection: "column", gap: 6, marginTop: 24 },
          [
            el("div", { fontSize: 24, fontWeight: 700, color: colors.inkMuted, display: "flex" }, "出典"),
            ...spec.sourceRefs.map((ref) =>
              el(
                "div",
                { fontSize: 22, color: colors.inkMuted, display: "flex" },
                `${ref.publisher}「${ref.title}」${ref.publishedAt ? `(${ref.publishedAt})` : ""}`,
              ),
            ),
          ],
        ),
      ],
      40,
    ),
    pageDots(colors, total, 4),
  ]);

  return [cover, facts, opinion, impact, ctaPage];
}
