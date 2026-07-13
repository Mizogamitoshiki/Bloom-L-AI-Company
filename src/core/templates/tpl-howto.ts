/**
 * tpl-howto: 課題解決カルーセル(柱⑥③向け)テンプレート(docs/11)。
 * 1080×1350(4:5)。表紙+本文3〜6+CTAの構成。
 * - 文字あふれ第1層: slidesSchemaの文字数上限(スキーマ側)
 * - 文字あふれ第2層: SLOTS定義に基づくSatori実測(renderer.measureSlotOverflows)
 * レンダリングは決定的(同一spec+同一トークン→同一出力)。
 */
import type { CarouselSpec, Slides, PostPlan } from "../schemas";

export const CANVAS = { width: 1080, height: 1350 } as const;
export const SAFE = 64; // セーフエリア(px)
const CONTENT_WIDTH = CANVAS.width - SAFE * 2; // 952

export interface BrandColors {
  primary: string;
  primaryDark: string;
  accent: string;
  surface: string;
  ink: string;
  inkMuted: string;
}

export const PILLAR_LABEL: Record<CarouselSpec["pillar"], string> = {
  "1": "IT・AIニュース",
  "2": "HPの役割",
  "3": "HPで変わる",
  "4": "Web・ITの気になる話",
  "5": "制作実績",
  "6": "泉州の事業者さまへ",
};

/** テキストスロット定義(実測検査の対象) */
export interface SlotDef {
  id: string;
  width: number;
  fontSize: number;
  lineHeight: number;
  weight: 400 | 700;
  maxHeight: number;
}

export const SLOT_DEFS = {
  coverTitle: { id: "cover.title", width: CONTENT_WIDTH, fontSize: 72, lineHeight: 1.35, weight: 700, maxHeight: 400 },
  coverSubtitle: { id: "cover.subtitle", width: CONTENT_WIDTH, fontSize: 40, lineHeight: 1.5, weight: 400, maxHeight: 130 },
  pageHeading: { id: "pages[i].heading", width: CONTENT_WIDTH, fontSize: 52, lineHeight: 1.3, weight: 700, maxHeight: 140 },
  pageBody: { id: "pages[i].body", width: CONTENT_WIDTH, fontSize: 40, lineHeight: 1.75, weight: 400, maxHeight: 700 },
  ctaMessage: { id: "cta.message", width: CONTENT_WIDTH, fontSize: 56, lineHeight: 1.5, weight: 700, maxHeight: 350 },
} as const satisfies Record<string, SlotDef>;

export interface SlotText {
  def: SlotDef;
  /** 実測対象の識別子(例: pages[2].body) */
  slotPath: string;
  text: string;
}

/** specから実測すべき全スロットを列挙 */
export function enumerateSlots(spec: CarouselSpec): SlotText[] {
  const s: SlotText[] = [
    { def: SLOT_DEFS.coverTitle, slotPath: "cover.title", text: spec.slides.cover.title },
  ];
  if (spec.slides.cover.subtitle.length > 0) {
    s.push({ def: SLOT_DEFS.coverSubtitle, slotPath: "cover.subtitle", text: spec.slides.cover.subtitle });
  }
  spec.slides.pages.forEach((p, i) => {
    s.push({ def: SLOT_DEFS.pageHeading, slotPath: `pages[${i}].heading`, text: p.heading });
    s.push({ def: SLOT_DEFS.pageBody, slotPath: `pages[${i}].body`, text: p.body });
  });
  s.push({ def: SLOT_DEFS.ctaMessage, slotPath: "cta.message", text: spec.slides.ctaMessage });
  return s;
}

// ---- Satoriノード(Reactに依存しないオブジェクト形式) ----
export interface SatoriNode {
  type: string;
  props: Record<string, unknown> & { children?: SatoriNode | SatoriNode[] | string };
}

const FONT = "Noto Sans JP";

function el(type: string, style: Record<string, unknown>, children?: SatoriNode | SatoriNode[] | string): SatoriNode {
  return { type, props: { style, children } };
}

function frame(colors: BrandColors, children: SatoriNode[]): SatoriNode {
  return el(
    "div",
    {
      width: CANVAS.width,
      height: CANVAS.height,
      display: "flex",
      flexDirection: "column",
      backgroundColor: colors.surface,
      fontFamily: FONT,
      color: colors.ink,
      padding: SAFE,
    },
    children,
  );
}

function brandBar(colors: BrandColors, right: string): SatoriNode {
  return el(
    "div",
    { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" },
    [
      el("div", { display: "flex", alignItems: "center", gap: 12 }, [
        el("div", { width: 28, height: 28, backgroundColor: colors.primary, borderRadius: 6, display: "flex" }),
        el("div", { fontSize: 32, fontWeight: 700, color: colors.primaryDark, display: "flex" }, "Bloom-L"),
      ]),
      el("div", { fontSize: 26, color: colors.inkMuted, display: "flex" }, right),
    ],
  );
}

function pageDots(colors: BrandColors, total: number, current: number): SatoriNode {
  const dots: SatoriNode[] = [];
  for (let i = 0; i < total; i++) {
    dots.push(
      el("div", {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: i === current ? colors.primary : "#c9c2b2",
        display: "flex",
      }),
    );
  }
  return el("div", { display: "flex", gap: 10, justifyContent: "center", width: "100%" }, dots);
}

export function buildPages(spec: CarouselSpec, colors: BrandColors): SatoriNode[] {
  const total = spec.slides.pages.length + 2;
  const pillarLabel = PILLAR_LABEL[spec.pillar];
  const pages: SatoriNode[] = [];

  // 表紙
  pages.push(
    frame(colors, [
      brandBar(colors, pillarLabel),
      el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 36 }, [
        el(
          "div",
          {
            fontSize: SLOT_DEFS.coverTitle.fontSize,
            whiteSpace: "pre-wrap",
            lineHeight: SLOT_DEFS.coverTitle.lineHeight,
            fontWeight: 700,
            display: "flex",
            maxHeight: SLOT_DEFS.coverTitle.maxHeight,
            overflow: "hidden",
          },
          spec.slides.cover.title,
        ),
        ...(spec.slides.cover.subtitle
          ? [
              el(
                "div",
                {
                  fontSize: SLOT_DEFS.coverSubtitle.fontSize,
            whiteSpace: "pre-wrap",
                  lineHeight: SLOT_DEFS.coverSubtitle.lineHeight,
                  color: colors.inkMuted,
                  display: "flex",
                  maxHeight: SLOT_DEFS.coverSubtitle.maxHeight,
                  overflow: "hidden",
                },
                spec.slides.cover.subtitle,
              ),
            ]
          : []),
        el("div", { width: 120, height: 10, backgroundColor: colors.accent, display: "flex" }),
      ]),
      pageDots(colors, total, 0),
    ]),
  );

  // 本文ページ
  spec.slides.pages.forEach((p, i) => {
    pages.push(
      frame(colors, [
        brandBar(colors, `${i + 1} / ${spec.slides.pages.length}`),
        el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 40 }, [
          el("div", { display: "flex", alignItems: "center", gap: 20 }, [
            el(
              "div",
              {
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: colors.primary,
                color: "#ffffff",
                fontSize: 36,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              },
              String(i + 1),
            ),
            el(
              "div",
              {
                fontSize: SLOT_DEFS.pageHeading.fontSize,
            whiteSpace: "pre-wrap",
                lineHeight: SLOT_DEFS.pageHeading.lineHeight,
                fontWeight: 700,
                display: "flex",
                maxHeight: SLOT_DEFS.pageHeading.maxHeight,
                overflow: "hidden",
                flexShrink: 1,
              },
              p.heading,
            ),
          ]),
          el(
            "div",
            {
              fontSize: SLOT_DEFS.pageBody.fontSize,
              lineHeight: SLOT_DEFS.pageBody.lineHeight,
              display: "flex",
              whiteSpace: "pre-wrap",
              maxHeight: SLOT_DEFS.pageBody.maxHeight,
              overflow: "hidden",
            },
            p.body,
          ),
        ]),
        pageDots(colors, total, i + 1),
      ]),
    );
  });

  // CTAページ
  pages.push(
    frame(colors, [
      brandBar(colors, pillarLabel),
      el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: 48, alignItems: "center" }, [
        el(
          "div",
          {
            fontSize: SLOT_DEFS.ctaMessage.fontSize,
            whiteSpace: "pre-wrap",
            lineHeight: SLOT_DEFS.ctaMessage.lineHeight,
            fontWeight: 700,
            display: "flex",
            textAlign: "center",
            maxHeight: SLOT_DEFS.ctaMessage.maxHeight,
            overflow: "hidden",
          },
          spec.slides.ctaMessage,
        ),
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
          },
          "DMで「相談」とお送りください",
        ),
        el("div", { fontSize: 28, color: colors.inkMuted, display: "flex" }, "泉州地域のHP制作・IT支援 Bloom-L"),
      ]),
      pageDots(colors, total, total - 1),
    ]),
  );

  return pages;
}

/** 昊のplanと琴葉のcopyからカルーセル仕様を構築する(通常コード。AIを使わない) */
export function buildSpecFromContent(plan: PostPlan, sourceCopyArtifactId: string, slides: Slides): CarouselSpec {
  return { kind: "carousel_spec", templateId: "tpl-howto", pillar: plan.pillar, sourceCopyArtifactId, slides };
}

/** テンプレートの期待ページ数(表紙+本文+CTA)。QAゲートの枚数検証に使用 */
export function expectedPageCount(spec: CarouselSpec): number {
  return spec.slides.pages.length + 2;
}
