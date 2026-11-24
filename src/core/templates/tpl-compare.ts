/**
 * comparison/checklist 系統(V4.5 v3)。table と diagnosis で本文layoutを実質的に分ける。
 *  - table: 表紙(構成)→ 判断材料 → 比較表 → セルフ診断 → 結論(次の一歩)→ CTA
 *  - diagnosis: 表紙(Before/After)→ YES/NO判断フロー → スコアカード → 結果別アクション → 結論 → CTA
 * 01〜05は両variantで異なるlayoutId。単一小カード+大余白を禁止。
 */
import type { CompareSpec } from "../schemas";
import { CONTENT_WIDTH, SPACE, RADIUS, type Theme } from "./design-system";
import {
  page, header, footer, body, tag, barHeading, quoteCard, comparisonTable, checkItem, contentsCard,
  beforeAfterCard, swipeHint, actionList, scoreCard, miniChecklist, iconCheck, iconCross,
  text, slot, el, typeStyle, pg, type SatoriNode, type RenderedPage, type SlotText,
} from "./components";
import { pillarKicker } from "./family-util";
import { ctaPage } from "./tpl-howto";

export const VARIANTS = ["table", "diagnosis"] as const;
export type CompareVariant = (typeof VARIANTS)[number];

const WIDE = CONTENT_WIDTH - 12 - SPACE.md - SPACE.lg * 2;
const CELL = 340;
const CHECK_W = CONTENT_WIDTH - 44 - SPACE.md - SPACE.lg * 2;

export function pickVariant(spec: CompareSpec): CompareVariant {
  if (spec.layoutVariant && (VARIANTS as readonly string[]).includes(spec.layoutVariant)) return spec.layoutVariant as CompareVariant;
  return "table";
}

export function enumerateSlots(spec: CompareSpec): SlotText[] {
  const s: SlotText[] = [
    slot("cover.title", spec.slides.cover.title, "h1", CONTENT_WIDTH, 3),
    slot("cover.subtitle", spec.slides.cover.subtitle, "lead", CONTENT_WIDTH, 2),
    slot("intro.heading", spec.slides.intro.heading, "label", WIDE, 2),
    slot("intro.body", spec.slides.intro.body, "body", WIDE, 4),
    slot("verdict.heading", spec.slides.verdict.heading, "label", WIDE, 2),
    slot("verdict.body", spec.slides.verdict.body, "body", WIDE, 4),
    slot("cta.message", spec.slides.ctaMessage, "h2", CONTENT_WIDTH, 4),
  ];
  spec.slides.rows.forEach((r, i) => {
    s.push(slot(`rows[${i}].before`, r.before, "body", CELL, 3));
    s.push(slot(`rows[${i}].after`, r.after, "body", CELL, 3));
    s.push(slot(`diag[${i}]`, r.before, "bodyStrong", CHECK_W, 2));
  });
  return s;
}

export function layoutIds(_spec: CompareSpec, variant: CompareVariant): string[] {
  return variant === "diagnosis"
    ? ["cmp-cover-diagnosis", "cmp-flow", "cmp-scorecard", "cmp-actions", "cmp-conclusion", "cta"]
    : ["cmp-cover-table", "cmp-intro", "cmp-table", "cmp-selfcheck", "cmp-conclusion", "cta"];
}

export function expectedPages(): number {
  return 6;
}

export function buildPages(spec: CompareSpec, theme: Theme, variant: CompareVariant = pickVariant(spec)): RenderedPage[] {
  return variant === "diagnosis" ? buildDiagnosis(spec, theme) : buildTable(spec, theme);
}

function conclusionPage(spec: CompareSpec, theme: Theme, cur: number): RenderedPage {
  return pg("cmp-conclusion", page(theme, "white", [
    header(theme, "結論"),
    body([
      barHeading(theme, "h2", spec.slides.verdict.heading),
      quoteCard(theme, "次の一歩", spec.slides.verdict.body, "accent"),
      actionList(theme, ["当てはまる項目をメモする", "気になる点はコメントかDMで教えてください"]),
    ], { gap: SPACE.lg, justify: "center" }),
    footer(theme, 6, cur),
  ]));
}

// ---- table ----
function buildTable(spec: CompareSpec, theme: Theme): RenderedPage[] {
  return [
    pg("cmp-cover-table", page(theme, "white", [
      header(theme, pillarKicker(spec.pillar)),
      body([
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          tag(theme, "比較 ・ セルフ診断", "soft"),
          text("h1", spec.slides.cover.title, { color: theme.colors.ink }),
          text("lead", spec.slides.cover.subtitle, { color: theme.colors.inkMuted }),
        ]),
        contentsCard(theme, "この投稿でわかること", ["見直し前後の比較表", "セルフ診断チェック", "次の一歩"]),
        swipeHint(theme, 6),
      ], { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, 6, 0, { cta: "保存" }),
    ])),
    pg("cmp-intro", page(theme, "soft", [
      header(theme, "この投稿でわかること"),
      body([
        barHeading(theme, "h2", spec.slides.intro.heading),
        quoteCard(theme, "ポイント", spec.slides.intro.body, "primary"),
        miniChecklist(theme, "この投稿の構成", ["現状によくあること", "見直したあとの姿", "次の一歩"]),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 1),
    ])),
    pg("cmp-table", page(theme, "white", [
      header(theme, "比較でわかる違い"),
      body([
        barHeading(theme, "h2", "見直し前 と 見直し後"),
        comparisonTable(theme, ["見直し前", "見直し後"], spec.slides.rows.map((r) => [r.before, r.after] as [string, string])),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 2),
    ])),
    pg("cmp-selfcheck", page(theme, "soft", [
      header(theme, "セルフ診断"),
      body([
        barHeading(theme, "h2", "ひとつでも当てはまったら"),
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, spec.slides.rows.map((r) => checkItem(theme, r.before, "primary"))),
        el("div", { ...typeStyle("caption"), color: theme.colors.inkMuted }, "当てはまる項目が多いほど、見直しで解決できる余地があります。"),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 3),
    ])),
    conclusionPage(spec, theme, 4),
    pg("cta", ctaPage(theme, spec.slides.ctaMessage, { badge: "保存する", sub: "チェックに使えます" }, 6, 5)),
  ];
}

// ---- diagnosis(YES/NO判断フロー + スコア + 結果別アクション) ----
function buildDiagnosis(spec: CompareSpec, theme: Theme): RenderedPage[] {
  const p = theme.colors;
  const rows = spec.slides.rows;
  return [
    pg("cmp-cover-diagnosis", page(theme, "white", [
      header(theme, pillarKicker(spec.pillar)),
      body([
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          tag(theme, "セルフ診断 ・ 3問", "soft"),
          text("h1", spec.slides.cover.title, { color: p.ink }),
          text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
        ]),
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, backgroundColor: p.primarySoft, borderRadius: 28, padding: SPACE.lg }, [
          el("div", { ...typeStyle("label"), color: p.primaryDark }, "たとえば、こう変わる"),
          beforeAfterCard(theme, rows[0]!.before, rows[0]!.after, { before: "見直し前", after: "見直し後" }),
        ]),
        swipeHint(theme, 6),
      ], { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, 6, 0, { cta: "保存" }),
    ])),
    pg("cmp-flow", page(theme, "soft", [
      header(theme, "YES / NO で判断"),
      body([
        barHeading(theme, "h2", "当てはまりますか?"),
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, rows.slice(0, 4).map((r, i) =>
          el("div", { display: "flex", alignItems: "center", gap: SPACE.md, backgroundColor: "#fff", border: `2px solid ${p.line}`, borderRadius: RADIUS.md, padding: `${SPACE.md}px ${SPACE.lg}px` }, [
            el("div", { width: 46, height: 46, borderRadius: 999, backgroundColor: p.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, flexShrink: 0 }, `Q${i + 1}`),
            el("div", { fontSize: 28, fontWeight: 700, color: p.ink, display: "flex", flexGrow: 1, whiteSpace: "pre-wrap" }, r.before),
            el("div", { display: "flex", gap: 6 }, [iconCheck(p.primary, 40), iconCross(p.inkMuted, 40)]),
          ]),
        )),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 1),
    ])),
    pg("cmp-scorecard", page(theme, "white", [
      header(theme, "診断スコア"),
      body([
        barHeading(theme, "h2", "当てはまった数で判断"),
        // 紫苑QA(v8)対応: クライマックスページの密度向上。スコアと補足を縦に分散配置して空白帯をなくす
        el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "space-around" }, [
          scoreCard(theme, 3, Math.min(rows.length, 4), spec.slides.verdict.heading),
          el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
            el("div", { display: "flex", gap: SPACE.md, alignItems: "center", backgroundColor: p.primarySoft, borderRadius: RADIUS.md, padding: SPACE.lg }, [
              el("div", { fontSize: 30, fontWeight: 800, color: p.primaryDark, display: "flex" }, "0〜1個"),
              el("div", { ...typeStyle("body"), color: p.ink, display: "flex" }, "現状の見せ方でも土台はOK。定期的な見直しを"),
            ]),
            el("div", { display: "flex", gap: SPACE.md, alignItems: "center", backgroundColor: p.accentSoft, borderRadius: RADIUS.md, padding: SPACE.lg }, [
              el("div", { fontSize: 30, fontWeight: 800, color: "#8a5a0a", display: "flex" }, "2個以上"),
              el("div", { ...typeStyle("body"), color: p.ink, display: "flex" }, "見直しの効果が出やすい状態です"),
            ]),
          ]),
          el("div", { ...typeStyle("caption"), color: p.inkMuted }, "スコアは例示(デモ)です。実際はご自身の回答数でご判断ください。"),
        ]),
      ], { gap: SPACE.lg, justify: "flex-start" }),
      footer(theme, 6, 2),
    ])),
    pg("cmp-actions", page(theme, "soft", [
      header(theme, "結果別・今やること"),
      body([
        barHeading(theme, "h2", "当てはまった数で次の一歩"),
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, backgroundColor: "#fff", border: `2px solid ${p.line}`, borderRadius: RADIUS.md, padding: SPACE.lg }, [
            el("div", { fontSize: 24, fontWeight: 800, color: p.primaryDark, display: "flex" }, "3つ以上 当てはまった方"),
            el("div", { fontSize: 27, fontWeight: 700, color: p.ink, display: "flex", whiteSpace: "pre-wrap" }, "見直しで解決できる余地が大きい状態です。まずはDMでご相談ください。"),
          ]),
          el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, backgroundColor: "#fff", border: `2px solid ${p.line}`, borderRadius: RADIUS.md, padding: SPACE.lg }, [
            el("div", { fontSize: 24, fontWeight: 800, color: p.primaryDark, display: "flex" }, "1〜2つ の方"),
            el("div", { fontSize: 27, fontWeight: 700, color: p.ink, display: "flex", whiteSpace: "pre-wrap" }, "まず情報整理から。この投稿を保存して見返してください。"),
          ]),
        ]),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 3),
    ])),
    conclusionPage(spec, theme, 4),
    pg("cta", ctaPage(theme, spec.slides.ctaMessage, { badge: "保存する", sub: "チェックに使えます" }, 6, 5)),
  ];
}
