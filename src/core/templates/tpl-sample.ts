/**
 * sample/site-showcase 系統(V10, docs/32 §7)。颯が作ったサンプルサイトの撮影画面を紹介し、プラン適合を提案する。
 *  - showcase(7枚): 表紙(スマホ画面)→ 場面 → スマホ画面 → PC画面 → 制作の裏側 → プラン提案 → CTA
 *  - story(6枚):    表紙(PC画面)→ 場面→設計→画面→提案の流れ → 画面(SP+PC並置)→ 場面と裏側の対比 → プラン提案 → CTA
 * 価格帯(priceBand)はconfig/pricing.yamlから通常コードが注入する。撮影画像はassets経由で渡す(DB/specに画像本体は持たない)。
 * 「サンプル(架空)」であることを表紙・プランページに明示する。
 */
import type { SampleSpec } from "../schemas";
import type { TemplateRenderAssets } from "./index";
import { CONTENT_WIDTH, SPACE, RADIUS, type Theme } from "./design-system";
import {
  page, header, footer, body, tag, barHeading, quoteCard, miniChecklist, swipeHint, iconCheck, processFlow, splitTwo,
  text, slot, el, typeStyle, pg, type SatoriNode, type RenderedPage, type SlotText,
} from "./components";
import { ctaPage } from "./tpl-howto";

export const VARIANTS = ["showcase", "story"] as const;
export type SampleVariant = (typeof VARIANTS)[number];

const COVER_TEXT_W = 480;
const WIDE = CONTENT_WIDTH - 12 - SPACE.md - SPACE.lg * 2;
const CAPTION_W = CONTENT_WIDTH - SPACE.lg * 2;

export function pickVariant(spec: SampleSpec): SampleVariant {
  if (spec.layoutVariant && (VARIANTS as readonly string[]).includes(spec.layoutVariant)) return spec.layoutVariant as SampleVariant;
  return "showcase";
}

export function enumerateSlots(spec: SampleSpec): SlotText[] {
  const s = spec.slides;
  return [
    slot("cover.title", s.cover.title, "h2", COVER_TEXT_W, 3),
    slot("cover.subtitle", s.cover.subtitle, "lead", COVER_TEXT_W, 3),
    slot("scene.heading", s.scene.heading, "label", WIDE, 2),
    slot("scene.body", s.scene.body, "body", WIDE, 4),
    slot("screens[0].caption", s.screens[0]!.caption, "body", CAPTION_W, 2),
    slot("screens[1].caption", s.screens[1]!.caption, "body", CAPTION_W, 2),
    slot("behind.heading", s.behind.heading, "label", WIDE, 2),
    slot("behind.body", s.behind.body, "body", WIDE, 4),
    slot("plan.note", s.plan.note, "body", WIDE, 2),
    slot("cta.message", s.ctaMessage, "h2", CONTENT_WIDTH, 4),
  ];
}

export function layoutIds(_spec: SampleSpec, variant: SampleVariant): string[] {
  return variant === "story"
    ? ["sm-cover-story", "sm-flow", "sm-screens-pair", "sm-behind-split", "sm-plan", "cta"]
    : ["sm-cover-showcase", "sm-scene", "sm-screen-sp", "sm-screen-pc", "sm-behind", "sm-plan", "cta"];
}

export function expectedPages(spec: SampleSpec): number {
  return pickVariant(spec) === "story" ? 6 : 7;
}

type ShotMedia = { width: number; height: number };

/** 撮影画像を端末風フレームへ。縦横比を保って幅基準で縮小し、縦に長い場合だけ上端基準で切る(HP画面は上部が最重要) */
function shotFrame(theme: Theme, dataUri: string, label: string, media: ShotMedia, frameWidth: number, maxHeight: number): SatoriNode {
  const p = theme.colors;
  const headerH = 56;
  const innerW = frameWidth - 16;
  const naturalH = Math.round((innerW * media.height) / media.width);
  const imageHeight = Math.max(80, Math.min(maxHeight - headerH - 16, naturalH));
  return el("div", {
    display: "flex", flexDirection: "column", width: frameWidth, borderRadius: RADIUS.xl,
    backgroundColor: "#fff", border: `8px solid ${p.ink}`, overflow: "hidden",
    boxShadow: "0 20px 50px rgba(22,35,63,0.22)", flexShrink: 0,
  }, [
    el("div", {
      display: "flex", alignItems: "center", justifyContent: "center", height: headerH, flexShrink: 0,
      backgroundColor: p.primary, color: "#fff", fontSize: 22, fontWeight: 800, padding: "0 16px", textAlign: "center",
    }, label),
    { type: "img", props: { src: dataUri, width: innerW, height: imageHeight, style: { display: "flex", objectFit: "cover", objectPosition: "top" } } },
  ]);
}

function sampleBadge(theme: Theme, siteTitle: string): SatoriNode {
  const p = theme.colors;
  return el("div", {
    backgroundColor: p.primarySoft, color: p.primaryDark, fontSize: 26, fontWeight: 700,
    padding: "8px 20px", borderRadius: 999, alignSelf: "flex-start", display: "flex",
  }, siteTitle);
}

function noticeCaption(theme: Theme): SatoriNode {
  return el("div", { ...typeStyle("caption"), color: theme.colors.inkMuted }, "架空のサンプルサイトです。実在の事業者・実績ではありません。");
}

function requireShots(assets?: TemplateRenderAssets): NonNullable<TemplateRenderAssets["sampleShots"]> {
  if (!assets?.sampleShots) throw new Error("サンプルの撮影画像がレンダラーへ安全に引き渡されていません");
  return assets.sampleShots;
}

function planPage(spec: SampleSpec, theme: Theme, total: number, cur: number): RenderedPage {
  const p = theme.colors;
  const band = spec.priceBand;
  const priceCard = (label: string, value: string): SatoriNode =>
    el("div", { display: "flex", flexDirection: "column", gap: SPACE.xs, backgroundColor: "#fff", borderRadius: RADIUS.lg, padding: SPACE.lg, flexGrow: 1, flexBasis: 0 }, [
      el("div", { ...typeStyle("label"), color: p.inkMuted }, label),
      el("div", { fontSize: 44, fontWeight: 800, color: p.primaryDark, display: "flex" }, value),
    ]);
  return pg("sm-plan", page(theme, "soft", [
    header(theme, `${String(cur).padStart(2, "0")} ・ プラン提案`),
    body([
      tag(theme, "承認済みの価格帯で提案", "soft"),
      barHeading(theme, "h2", `${band.label}の範囲で制作できる構成`),
      el("div", { display: "flex", gap: SPACE.md, width: "100%" }, [priceCard("制作費(目安)", band.build), priceCard("保守(目安)", band.maintenance)]),
      quoteCard(theme, "このサンプルが適合する理由", spec.slides.plan.note, "primary"),
      el("div", { display: "flex", alignItems: "center", gap: SPACE.md }, [
        iconCheck(p.primary, 36),
        el("div", { ...typeStyle("body"), color: p.ink, display: "flex" }, band.disclaimer),
      ]),
      noticeCaption(theme),
    ], { gap: SPACE.lg, justify: "center" }),
    footer(theme, total, cur),
  ]));
}

function ctaPg(spec: SampleSpec, theme: Theme, total: number): RenderedPage {
  return pg("cta", ctaPage(theme, spec.slides.ctaMessage, { badge: "DMで相談", sub: "「サンプル」とメッセージしてください" }, total, total - 1));
}

export function buildPages(spec: SampleSpec, theme: Theme, variant: SampleVariant = pickVariant(spec), assets?: TemplateRenderAssets): RenderedPage[] {
  return variant === "story" ? buildStory(spec, theme, assets) : buildShowcase(spec, theme, assets);
}

// ---- showcase(7枚) ----
function buildShowcase(spec: SampleSpec, theme: Theme, assets?: TemplateRenderAssets): RenderedPage[] {
  const p = theme.colors;
  const shots = requireShots(assets);
  const sp = spec.screenshots.spFold;
  const pc = spec.screenshots.pcFold;
  const total = 7;
  return [
    pg("sm-cover-showcase", page(theme, "white", [
      header(theme, "制作サンプル"),
      body([
        el("div", { display: "flex", gap: SPACE.xl, alignItems: "center", width: "100%" }, [
          el("div", { display: "flex", flexDirection: "column", gap: SPACE.md, width: COVER_TEXT_W }, [
            tag(theme, "SAMPLE ・ 架空のサイト", "soft"),
            text("h2", spec.slides.cover.title, { color: p.ink }),
            sampleBadge(theme, spec.sampleTitle),
            text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
          ]),
          el("div", { display: "flex", flexGrow: 1, justifyContent: "center" }, [shotFrame(theme, shots.spFold.dataUri, "スマホ表示", sp, 360, 640)]),
        ]),
        swipeHint(theme, total),
      ], { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, total, 0, { cta: "DMで相談" }),
    ])),
    pg("sm-scene", page(theme, "soft", [
      header(theme, "01 ・ 場面"),
      body([
        barHeading(theme, "h2", "こんな会社を想定しました"),
        quoteCard(theme, spec.slides.scene.heading, spec.slides.scene.body, "accent"),
        miniChecklist(theme, "このサンプルで見せること", ["スマホでの見え方", "PCでの見え方", "どのプランの範囲で作れるか"]),
        el("div", { ...typeStyle("caption"), color: p.inkMuted }, "次のページから、実際に組んだサンプル画面を紹介します。"),
      ], { gap: SPACE.xl, justify: "center" }),
      footer(theme, total, 1),
    ])),
    pg("sm-screen-sp", page(theme, "white", [
      header(theme, "02 ・ スマホ画面"),
      body([
        el("div", { display: "flex", justifyContent: "center", width: "100%" }, [shotFrame(theme, shots.spFold.dataUri, "スマホ表示(ファーストビュー)", sp, 440, 900)]),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink, textAlign: "center", justifyContent: "center", width: "100%" }, spec.slides.screens[0]!.caption),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, total, 2),
    ])),
    pg("sm-screen-pc", page(theme, "white", [
      header(theme, "03 ・ PC画面"),
      body([
        el("div", { display: "flex", justifyContent: "center", width: "100%" }, [shotFrame(theme, shots.pcFold.dataUri, "PC表示(ファーストビュー)", pc, CONTENT_WIDTH, 700)]),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink, textAlign: "center", justifyContent: "center", width: "100%" }, spec.slides.screens[1]!.caption),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, total, 3),
    ])),
    pg("sm-behind", page(theme, "soft", [
      header(theme, "04 ・ 制作の裏側"),
      body([
        barHeading(theme, "h2", spec.slides.behind.heading),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink, width: WIDE }, spec.slides.behind.body),
        miniChecklist(theme, "サンプルの作り方", ["デザイン画像をそのままHTML/CSSで再現", "スマホ・PCの両方で崩れを確認", "実在情報は入れず架空の屋号で制作"]),
      ], { gap: SPACE.xl, justify: "center" }),
      footer(theme, total, 4),
    ])),
    planPage(spec, theme, total, 5),
    ctaPg(spec, theme, total),
  ];
}

// ---- story(6枚) ----
function buildStory(spec: SampleSpec, theme: Theme, assets?: TemplateRenderAssets): RenderedPage[] {
  const p = theme.colors;
  const shots = requireShots(assets);
  const sp = spec.screenshots.spFold;
  const pc = spec.screenshots.pcFold;
  const total = 6;
  return [
    pg("sm-cover-story", page(theme, "soft", [
      header(theme, "制作サンプル"),
      body([
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          tag(theme, "SAMPLE ・ 架空のサイト", "soft"),
          text("h2", spec.slides.cover.title, { color: p.ink }),
          sampleBadge(theme, spec.sampleTitle),
          text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
        ]),
        el("div", { display: "flex", justifyContent: "center", width: "100%" }, [shotFrame(theme, shots.pcFold.dataUri, "PC表示", pc, 700, 560)]),
        swipeHint(theme, total),
      ], { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, total, 0, { cta: "DMで相談" }),
    ])),
    pg("sm-flow", page(theme, "white", [
      header(theme, "制作の流れ"),
      body([
        barHeading(theme, "h2", "場面から提案までの流れ"),
        processFlow(theme, [
          { label: "場面", heading: spec.slides.scene.heading },
          { label: "設計", heading: spec.slides.behind.heading },
          { label: "画面", heading: "スマホとPCで確認" },
          { label: "提案", heading: `${spec.priceBand.label}で提案` },
        ]),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink, width: WIDE }, spec.slides.scene.body),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, total, 1),
    ])),
    pg("sm-screens-pair", page(theme, "white", [
      header(theme, "サンプル画面"),
      body([
        el("div", { display: "flex", gap: SPACE.lg, alignItems: "flex-start", justifyContent: "center", width: "100%" }, [
          shotFrame(theme, shots.spFold.dataUri, "スマホ", sp, 300, 620),
          shotFrame(theme, shots.pcFold.dataUri, "PC", pc, 600, 620),
        ]),
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, width: "100%" }, [
          el("div", { display: "flex", alignItems: "center", gap: SPACE.md }, [iconCheck(p.primary, 36), el("div", { ...typeStyle("body"), color: p.ink, display: "flex" }, spec.slides.screens[0]!.caption)]),
          el("div", { display: "flex", alignItems: "center", gap: SPACE.md }, [iconCheck(p.primary, 36), el("div", { ...typeStyle("body"), color: p.ink, display: "flex" }, spec.slides.screens[1]!.caption)]),
        ]),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, total, 2),
    ])),
    pg("sm-behind-split", page(theme, "soft", [
      header(theme, "設計の判断"),
      body([
        barHeading(theme, "h2", "なぜこの構成にしたか"),
        splitTwo(theme, { label: "場面", text: spec.slides.scene.heading, tone: "accent" }, { label: "設計", text: spec.slides.behind.heading, tone: "primary" }),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink, width: WIDE }, spec.slides.behind.body),
        noticeCaption(theme),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, total, 3),
    ])),
    planPage(spec, theme, total, 4),
    ctaPg(spec, theme, total),
  ];
}
