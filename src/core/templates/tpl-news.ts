/**
 * news/insight 系統(V4.5 v3)。report と insight で本文layoutを実質的に分ける。
 *  - report(報道・事実整理型): 表紙 → 事実カード → 事実→変化→影響フロー → 影響+今できること → 出典 → CTA
 *  - insight(分析・解釈型): 表紙(検索/AI画面) → 画面図+観測 → 見解(事実と分離) → 影響+アクション → 判断チェック → CTA
 * 01〜05は両variantで異なるlayoutId。長文は広い幅で描画し可読性を確保。
 */
import type { NewsSpec } from "../schemas";
import { CONTENT_WIDTH, SPACE, RADIUS, type Theme } from "./design-system";
import {
  page, header, footer, body, tag, barHeading, quoteCard, sourceCard, contentsCard,
  screenMock, swipeHint, changeFlow, impactList, splitTwo, miniChecklist,
  numberBadge, text, slot, el, typeStyle, pg, type SatoriNode, type RenderedPage, type SlotText,
} from "./components";
import { pillarKicker } from "./family-util";
import { ctaPage } from "./tpl-howto";

export const VARIANTS = ["report", "insight"] as const;
export type NewsVariant = (typeof VARIANTS)[number];

const WIDE = CONTENT_WIDTH - 64 - SPACE.md - SPACE.lg; // カード内の広い本文幅 ≈ 816

/**
 * 紫苑QA(v10)対応: space-aroundは「要素間=端の2倍」の余白になり空白が中間に集中する。
 * Satoriはspace-evenly未対応のため、flexGrowスペーサーで上・間・下を厳密に均等化する。
 */
function evenSpread(children: SatoriNode[]): SatoriNode {
  const spacer = (): SatoriNode => el("div", { flexGrow: 1, display: "flex" }, "");
  const out: SatoriNode[] = [spacer()];
  for (const c of children) out.push(c, spacer());
  return el("div", { display: "flex", flexDirection: "column", flexGrow: 1, width: "100%" }, out);
}

export function pickVariant(spec: NewsSpec): NewsVariant {
  if (spec.layoutVariant && (VARIANTS as readonly string[]).includes(spec.layoutVariant)) return spec.layoutVariant as NewsVariant;
  return "report";
}

export function enumerateSlots(spec: NewsSpec): SlotText[] {
  const s: SlotText[] = [
    slot("cover.title", spec.slides.cover.title, "h1", CONTENT_WIDTH, 3),
    slot("cover.subtitle", spec.slides.cover.subtitle, "lead", CONTENT_WIDTH, 2),
  ];
  spec.slides.facts.forEach((f, i) => s.push(slot(`facts[${i}]`, f.text, "body", WIDE, 4)));
  s.push(slot("opinion.heading", spec.slides.opinion.heading, "label", WIDE, 2));
  s.push(slot("opinion.body", spec.slides.opinion.body, "body", WIDE, 4));
  s.push(slot("impact.heading", spec.slides.impact.heading, "label", WIDE, 2));
  s.push(slot("impact.body", spec.slides.impact.body, "body", WIDE, 4));
  spec.sourceRefs.forEach((r, i) => s.push(slot(`source[${i}]`, r.title, "caption", CONTENT_WIDTH - SPACE.lg * 2, 2)));
  s.push(slot("cta.message", spec.slides.ctaMessage, "h2", CONTENT_WIDTH, 4));
  return s;
}

export function layoutIds(_spec: NewsSpec, variant: NewsVariant): string[] {
  return variant === "insight"
    ? ["news-cover-insight", "news-screen-observe", "news-fact-opinion", "news-impact-action", "news-judgment", "cta"]
    : ["news-cover-report", "news-fact-cards", "news-change-flow", "news-impact-today", "news-sources", "cta"];
}

export function expectedPages(): number {
  return 6;
}

export function buildPages(spec: NewsSpec, theme: Theme, variant: NewsVariant = pickVariant(spec)): RenderedPage[] {
  return variant === "insight" ? buildInsight(spec, theme) : buildReport(spec, theme);
}

function sourcesPage(spec: NewsSpec, theme: Theme, cur: number): RenderedPage {
  const p = theme.colors;
  return pg("news-sources", page(theme, "soft", [
    header(theme, "出典"),
    body([
      barHeading(theme, "h2", "情報の出どころ"),
      // 紫苑QA(v11)対応: 出典カードもサブ列にせず直接均等配置(カード間だけ狭くなる問題の修正)
      evenSpread([
        ...spec.sourceRefs.map((r) => sourceCard(theme, r.publisher, r.title, r.publishedAt)),
        el("div", { ...typeStyle("caption"), color: p.inkMuted }, "確認日時点の情報です。最新の状況は各出典をご確認ください。"),
      ]),
    ], { gap: SPACE.lg, justify: "flex-start" }),
    footer(theme, 6, cur),
  ]));
}

// ---- report(報道・事実整理型) ----
function buildReport(spec: NewsSpec, theme: Theme): RenderedPage[] {
  const p = theme.colors;
  const k = pillarKicker(spec.pillar);
  return [
    pg("news-cover-report", page(theme, "white", [
      header(theme, k),
      body([
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          tag(theme, "NEWS ・ 事実にもとづく解説", "soft"),
          text("h1", spec.slides.cover.title, { color: p.ink }),
          text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
        ]),
        contentsCard(theme, "この投稿の構成", ["確認できた事実", "事実・変化・影響", "泉州の事業者さまへの影響", "出典"]),
        swipeHint(theme, 6),
      ], { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, 6, 0, { cta: "プロフィールへ" }),
    ])),
    pg("news-fact-cards", page(theme, "white", [
      header(theme, "確認できた事実"),
      body([
        barHeading(theme, "h2", "いま起きていること"),
        // 紫苑QA(v10)対応: 上・間・下の余白を厳密に均等化(evenSpread)
        evenSpread(spec.slides.facts.map((f, i) =>
          el("div", { display: "flex", gap: SPACE.md, alignItems: "flex-start", backgroundColor: p.surface, border: `2px solid ${p.line}`, borderRadius: 20, padding: SPACE.lg }, [
            numberBadge(theme, i + 1, 64),
            el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink, width: WIDE }, f.text),
          ]),
        )),
      ], { gap: SPACE.lg, justify: "flex-start" }),
      footer(theme, 6, 1),
    ])),
    pg("news-change-flow", page(theme, "soft", [
      header(theme, "事実・変化・影響"),
      body([
        barHeading(theme, "h2", "何がどう変わるか"),
        // 紫苑QA(v10)対応: 上・間・下の余白を厳密に均等化(evenSpread)
        evenSpread([
          changeFlow(theme, [
            { label: "事実", text: spec.slides.cover.title },
            { label: "変化", text: spec.slides.opinion.heading },
            { label: "影響", text: spec.slides.impact.heading },
          ]),
          quoteCard(theme, spec.slides.opinion.heading, spec.slides.opinion.body, "accent"),
        ]),
      ], { gap: SPACE.lg, justify: "flex-start" }),
      footer(theme, 6, 2),
    ])),
    pg("news-impact-today", page(theme, "white", [
      header(theme, "泉州の事業者さまへの影響"),
      body([
        barHeading(theme, "h2", "影響をどう読むか"),
        // 紫苑QA(v11)対応: 上・間・下を厳密均等化(evenSpread)
        // V9(2026-08-10 QA指摘): copyに存在しない汎用actionListの注入を廃止。copy由来のimpact+事実/見解分離の注記で構成
        evenSpread([
          impactList(theme, [{ heading: spec.slides.impact.heading, text: spec.slides.impact.body }]),
          quoteCard(theme, "事実と見解を分けて読む", "このページにはBloom-Lの推測・見解が含まれます。数値・事実は出典の調査結果をご確認ください。", "primary"),
        ]),
      ], { gap: SPACE.lg, justify: "flex-start" }),
      footer(theme, 6, 3),
    ])),
    sourcesPage(spec, theme, 4),
    pg("cta", ctaPage(theme, spec.slides.ctaMessage, { badge: "プロフィールへ", sub: "リンクから詳しく見られます" }, 6, 5)),
  ];
}

// ---- insight(分析・解釈型) ----
function buildInsight(spec: NewsSpec, theme: Theme): RenderedPage[] {
  const p = theme.colors;
  const k = pillarKicker(spec.pillar);
  return [
    pg("news-cover-insight", page(theme, "white", [
      header(theme, k),
      body([
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          tag(theme, "INSIGHT ・ 分析と解釈", "soft"),
          text("h1", spec.slides.cover.title, { color: p.ink }),
          text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
        ]),
        screenMock(theme, "検索・AI回答(イメージ)", [
          { label: "AIによる要約回答", strong: true },
          { label: "関連する事業者・記事" },
          { label: "各サイトへのリンク" },
        ]),
        swipeHint(theme, 6),
      ], { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, 6, 0, { cta: "プロフィールへ" }),
    ])),
    pg("news-screen-observe", page(theme, "soft", [
      header(theme, "観測: 何が起きているか"),
      body([
        // 紫苑QA(v10)対応: 上・間・下の余白を厳密に均等化(evenSpread)
        evenSpread([
          screenMock(theme, "検索結果(イメージ)", [
            { label: "AIの要約回答が上部に表示", strong: true },
            { label: "従来の青リンクは下へ" },
          ]),
          el("div", { display: "flex", gap: SPACE.md, alignItems: "flex-start", backgroundColor: "#fff", border: `2px solid ${p.line}`, borderRadius: 20, padding: SPACE.lg }, [
            numberBadge(theme, 1, 56),
            el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink, width: WIDE }, spec.slides.facts[0]!.text),
          ]),
        ]),
      ], { gap: SPACE.lg, justify: "flex-start" }),
      footer(theme, 6, 1),
    ])),
    pg("news-fact-opinion", page(theme, "white", [
      header(theme, "事実 と 見解(分離)"),
      body([
        barHeading(theme, "h2", "事実とBloom-Lの見方"),
        splitTwo(theme,
          { label: "確認できた事実", text: spec.slides.facts[spec.slides.facts.length - 1]!.text, tone: "primary" },
          { label: "Bloom-Lの見解", text: spec.slides.opinion.heading, tone: "accent" },
        ),
        quoteCard(theme, spec.slides.opinion.heading, spec.slides.opinion.body, "accent"),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 2),
    ])),
    pg("news-impact-action", page(theme, "soft", [
      header(theme, "泉州の事業者さまへの影響"),
      body([
        barHeading(theme, "h2", "影響をどう読むか"),
        // 紫苑QA(v11)対応: 上・間・下を厳密均等化(evenSpread)
        // V9(2026-08-10 QA指摘): copyに存在しない汎用actionListの注入を廃止。copy由来のimpact+事実/見解分離の注記で構成
        evenSpread([
          impactList(theme, [{ heading: spec.slides.impact.heading, text: spec.slides.impact.body }]),
          quoteCard(theme, "事実と見解を分けて読む", "このページにはBloom-Lの推測・見解が含まれます。数値・事実は出典の調査結果をご確認ください。", "primary"),
        ]),
      ], { gap: SPACE.lg, justify: "flex-start" }),
      footer(theme, 6, 3),
    ])),
    pg("news-judgment", page(theme, "white", [
      header(theme, "自社は大丈夫? 判断チェック"),
      body([
        barHeading(theme, "h2", "当てはまるほど、対応の余地"),
        // 紫苑QA(v10)対応: 上・間・下の余白を厳密に均等化(evenSpread)
        evenSpread([
          miniChecklist(theme, "チェック項目", [
            "検索しても自社情報が出てこない",
            "営業時間や場所が探しにくい",
            "問い合わせ手段がわかりにくい",
          ]),
          el("div", { ...typeStyle("caption"), color: p.inkMuted }, "架空データによるデモです。実際の判断は各出典と自社状況でご確認ください。"),
        ]),
      ], { gap: SPACE.lg, justify: "flex-start" }),
      footer(theme, 6, 4),
    ])),
    pg("cta", ctaPage(theme, spec.slides.ctaMessage, { badge: "プロフィールへ", sub: "リンクから詳しく見られます" }, 6, 5)),
  ];
}
