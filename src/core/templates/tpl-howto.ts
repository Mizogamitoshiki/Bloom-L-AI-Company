/**
 * education/howto 系統(V4.5 v3)。steps と guide で本文layoutを実質的に分ける。
 *  - steps: 表紙(内容予告)→ 各ステップ(番号/見出し/本文 + 具体例 or 確認チェック)→ まとめ(実践チェック)→ CTA
 *  - guide: 表紙(HP基本情報の設計図)→ 3ノードの実用タイムライン(すること/確認点)→ 完成イメージ → CTA
 * 01〜05は両variantで異なるlayoutId(stepsは3ノード以上でguideと別layout)。
 */
import type { HowtoSpec, Slides, PostPlan } from "../schemas";
import { CONTENT_WIDTH, SPACE, RADIUS, type Theme } from "./design-system";
import {
  page, header, footer, body, tag, barHeading, numberBadge, checkItem, contentsCard,
  timelineStep, swipeHint, iconCheck, exampleBox, miniChecklist,
  text, slot, el, typeStyle, pg, type SatoriNode, type RenderedPage, type SlotText,
} from "./components";
import { pillarKicker, ctaHint } from "./family-util";

export const VARIANTS = ["steps", "guide"] as const;
export type HowtoVariant = (typeof VARIANTS)[number];

const STEP_BODY_W = CONTENT_WIDTH - SPACE.xxl * 2;

export function pickVariant(spec: HowtoSpec): HowtoVariant {
  if (spec.layoutVariant && (VARIANTS as readonly string[]).includes(spec.layoutVariant)) return spec.layoutVariant as HowtoVariant;
  return "steps";
}

export function enumerateSlots(spec: HowtoSpec): SlotText[] {
  const s: SlotText[] = [
    slot("cover.title", spec.slides.cover.title, "h1", CONTENT_WIDTH, 3),
    slot("cover.subtitle", spec.slides.cover.subtitle, "lead", CONTENT_WIDTH, 2),
  ];
  spec.slides.pages.forEach((p, i) => {
    s.push(slot(`pages[${i}].heading`, p.heading, "h1", STEP_BODY_W - 140, 2));
    s.push(slot(`pages[${i}].body`, p.body, "lead", STEP_BODY_W, 5));
    s.push(slot(`summary[${i}]`, p.heading, "bodyStrong", CONTENT_WIDTH - 44 - SPACE.md - SPACE.lg * 2, 2));
  });
  s.push(slot("cta.message", spec.slides.ctaMessage, "h2", CONTENT_WIDTH, 4));
  return s;
}

export function expectedPages(spec: HowtoSpec): number {
  return spec.slides.pages.length + 3;
}

export function layoutIds(spec: HowtoSpec, variant: HowtoVariant): string[] {
  const ids: string[] = [];
  if (variant === "guide") {
    ids.push("howto-cover-guide");
    spec.slides.pages.forEach(() => ids.push("howto-timeline-node"));
    ids.push("howto-summary-practical", "cta");
  } else {
    ids.push("howto-cover-steps");
    spec.slides.pages.forEach((_, i) => ids.push(i % 2 === 1 ? "howto-step-band" : "howto-step-panel"));
    ids.push("howto-summary-check", "cta");
  }
  return ids;
}

export function buildPages(spec: HowtoSpec, theme: Theme, variant: HowtoVariant = pickVariant(spec)): RenderedPage[] {
  const total = expectedPages(spec);
  const pages: RenderedPage[] = [];
  let idx = 0;
  const ids = layoutIds(spec, variant);
  if (variant === "guide") {
    pages.push(pg(ids[idx]!, coverGuide(theme, spec, total, idx++)));
    spec.slides.pages.forEach((_step, i) => pages.push(pg(ids[idx]!, stepTimeline(theme, spec, i, total, idx++))));
    pages.push(pg(ids[idx]!, summaryPage(theme, spec, "guide", total, idx++)));
  } else {
    pages.push(pg(ids[idx]!, coverSteps(theme, spec, total, idx++)));
    spec.slides.pages.forEach((_step, i) => pages.push(pg(ids[idx]!, stepPanel(theme, spec, i, total, idx++))));
    pages.push(pg(ids[idx]!, summaryPage(theme, spec, "steps", total, idx++)));
  }
  pages.push(pg("cta", ctaPage(theme, spec.slides.ctaMessage, ctaHint(spec.pillar), total, idx)));
  return pages;
}

// ---- 表紙 ----
function coverSteps(theme: Theme, spec: HowtoSpec, total: number, cur: number): SatoriNode {
  const p = theme.colors;
  return page(theme, "white", [
    header(theme, pillarKicker(spec.pillar)),
    body([
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
        tag(theme, "保存版 HOW-TO", "soft"),
        text("h1", spec.slides.cover.title, { color: p.ink }),
        text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
      ]),
      contentsCard(theme, "この投稿の内容", spec.slides.pages.map((s) => s.heading)),
      swipeHint(theme, total),
    ], { gap: SPACE.lg, justify: "space-between" }),
    footer(theme, total, cur, { cta: "保存" }),
  ]);
}

function coverGuide(theme: Theme, spec: HowtoSpec, total: number, cur: number): SatoriNode {
  const p = theme.colors;
  const basics = ["営業時間・アクセス", "サービス・料金の目安", "実績・お客様の声", "問い合わせ導線"];
  return page(theme, "soft", [
    header(theme, pillarKicker(spec.pillar)),
    body([
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
        tag(theme, "はじめてガイド", "soft"),
        text("h1", spec.slides.cover.title, { color: p.ink }),
        text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
      ]),
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, backgroundColor: "#fff", borderRadius: RADIUS.lg, padding: SPACE.lg }, [
        el("div", { ...typeStyle("label"), color: p.primaryDark }, "HPに載せる基本情報"),
        ...basics.map((b) => el("div", { display: "flex", alignItems: "center", gap: SPACE.md }, [iconCheck(p.primary, 40), el("div", { fontSize: 30, fontWeight: 700, color: p.ink, display: "flex" }, b)])),
      ]),
      swipeHint(theme, total),
    ], { gap: SPACE.lg, justify: "space-between" }),
    footer(theme, total, cur, { cta: "保存" }),
  ]);
}

// ---- ステップ本文(steps: 具体例/確認モジュール付き。番号だけの連続を避ける) ----
function stepPanel(theme: Theme, spec: HowtoSpec, i: number, total: number, cur: number): SatoriNode {
  const p = theme.colors;
  const step = spec.slides.pages[i]!;
  const band = i % 2 === 1;
  const moduleNode = step.example
    ? exampleBox(theme, "具体例", step.example)
    : miniChecklist(theme, "この手順の確認", [`${step.heading}ができている`, "お客様目線で見て迷わない"]);
  return page(theme, "white", [
    header(theme, `STEP ${i + 1} / ${spec.slides.pages.length}`),
    el("div", {
      display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: SPACE.lg,
      backgroundColor: band ? "#fff" : p.primarySoft, border: band ? `2px solid ${p.line}` : "none", borderRadius: 40, padding: SPACE.xxl, marginTop: SPACE.lg, marginBottom: SPACE.lg,
    }, [
      el("div", { display: "flex", alignItems: "center", gap: SPACE.lg }, [
        numberBadge(theme, i + 1, band ? 96 : 120),
        el("div", { display: "flex", flexDirection: "column" }, [
          el("div", { ...typeStyle("kicker"), color: p.primary }, `STEP ${i + 1}`),
          el("div", { ...typeStyle("h1", { whiteSpace: "pre-wrap" }), color: p.primaryDark }, step.heading),
        ]),
      ]),
      el("div", { ...typeStyle("lead", { whiteSpace: "pre-wrap" }), color: p.ink }, step.body),
      moduleNode,
    ]),
    footer(theme, total, cur),
  ]);
}

function stepTimeline(theme: Theme, spec: HowtoSpec, i: number, total: number, cur: number): SatoriNode {
  const p = theme.colors;
  const step = spec.slides.pages[i]!;
  const n = spec.slides.pages.length;
  return page(theme, "white", [
    header(theme, `STEP ${i + 1} / ${n}`),
    body([
      el("div", { display: "flex", gap: SPACE.sm, alignItems: "center" }, spec.slides.pages.map((_, k) =>
        el("div", { flexGrow: 1, height: 10, borderRadius: 999, backgroundColor: k <= i ? p.primary : p.surfaceDark, display: "flex" }, ""),
      )),
      el("div", { display: "flex", backgroundColor: p.surfaceDark, borderRadius: 40, padding: SPACE.xxl }, [timelineStep(theme, i + 1, step.heading, step.body, true)]),
      miniChecklist(theme, "確認点", [`${step.heading}ができている`, "スマホで見て読みやすい"]),
    ], { gap: SPACE.lg, justify: "center" }),
    footer(theme, total, cur),
  ]);
}

function summaryPage(theme: Theme, spec: HowtoSpec, variant: HowtoVariant, total: number, cur: number): SatoriNode {
  const p = theme.colors;
  const title = variant === "guide" ? "完成イメージと実践チェック" : "この投稿でできること";
  return page(theme, "soft", [
    header(theme, pillarKicker(spec.pillar)),
    body([
      barHeading(theme, "h2", title),
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, spec.slides.pages.map((s) => checkItem(theme, s.heading, "ok"))),
      el("div", { ...typeStyle("caption"), color: p.inkMuted }, "保存しておくと、順番に見返しながら整えられます。"),
    ], { gap: SPACE.lg, justify: "center" }),
    footer(theme, total, cur, { cta: "保存して見返す" }),
  ]);
}

/** 共通CTAページ(青地・反転ロゴ)。押せるボタンには見せず、文章でも行動を明示 */
export function ctaPage(theme: Theme, message: string, hint: { badge: string; sub: string }, total: number, current: number): SatoriNode {
  return page(theme, "primary", [
    header(theme, "泉州のHP制作・IT支援", true),
    body([
      el("div", { ...typeStyle("h1", { whiteSpace: "pre-wrap" }), color: "#fff", textAlign: "center", justifyContent: "center" }, message),
      el("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: SPACE.md, marginTop: SPACE.md }, [
        el("div", { display: "flex", alignItems: "center", gap: SPACE.sm, backgroundColor: "rgba(255,255,255,0.16)", padding: "16px 32px", borderRadius: RADIUS.pill }, [
          el("div", { fontSize: 34, fontWeight: 800, color: "#fff", display: "flex" }, hint.badge),
        ]),
        el("div", { fontSize: 30, color: "rgba(255,255,255,0.92)", display: "flex", textAlign: "center", whiteSpace: "pre-wrap", justifyContent: "center" }, hint.sub),
      ]),
    ], { gap: SPACE.xl, justify: "center" }),
    footer(theme, total, current, { onDark: true }),
  ]);
}

export function buildSpecFromContent(plan: PostPlan, sourceCopyArtifactId: string, slides: Slides): HowtoSpec {
  return { kind: "carousel_spec", templateId: "tpl-howto", pillar: plan.pillar, sourceCopyArtifactId, slides };
}

export function expectedPageCount(spec: HowtoSpec): number {
  return expectedPages(spec);
}
