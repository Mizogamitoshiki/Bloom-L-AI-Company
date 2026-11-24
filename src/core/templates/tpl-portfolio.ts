/**
 * portfolio/case-study 系統(V4.5 v3)。showcase と story で本文layoutを実質的に分ける。
 *  - showcase: 表紙(端末モック)→ 課題 → 対応(注釈付きモック)→ 成果(できること)→ 技術 → CTA
 *  - story: 表紙(ストーリー)→ 課題→判断→設計→実装→確認のプロセス図 → 判断カード → Before/After → 技術 → CTA
 * displayNameは許可状態から通常コードが注入。fixtureは架空事例として明示。成果数値は捏造しない。
 */
import type { PortfolioSpec } from "../schemas";
import type { TemplateRenderAssets } from "./index";
import { CONTENT_WIDTH, SPACE, RADIUS, type Theme } from "./design-system";
import {
  page, header, footer, body, tag, barHeading, quoteCard, deviceMock, annotatedMock, techTags, checkItem,
  processFlow, splitTwo, beforeAfterCard, miniChecklist, swipeHint, iconCheck,
  text, slot, el, typeStyle, pg, type SatoriNode, type RenderedPage, type SlotText,
} from "./components";
import { ctaPage } from "./tpl-howto";

export const VARIANTS = ["showcase", "story"] as const;
export type PortfolioVariant = (typeof VARIANTS)[number];

const COVER_TEXT_W = 480;
const WIDE = CONTENT_WIDTH - 12 - SPACE.md - SPACE.lg * 2;

export function pickVariant(spec: PortfolioSpec): PortfolioVariant {
  if (spec.layoutVariant && (VARIANTS as readonly string[]).includes(spec.layoutVariant)) return spec.layoutVariant as PortfolioVariant;
  return "showcase";
}

export function enumerateSlots(spec: PortfolioSpec): SlotText[] {
  return [
    slot("cover.title", spec.slides.cover.title, "h2", COVER_TEXT_W, 3),
    slot("cover.subtitle", spec.slides.cover.subtitle, "lead", COVER_TEXT_W, 3),
    slot("challenge.heading", spec.slides.challenge.heading, "label", WIDE, 2),
    slot("challenge.body", spec.slides.challenge.body, "body", WIDE, 4),
    slot("approach.heading", spec.slides.approach.heading, "label", WIDE, 2),
    slot("approach.body", spec.slides.approach.body, "body", WIDE, 4),
    slot("result.heading", spec.slides.result.heading, "label", WIDE, 2),
    slot("result.body", spec.slides.result.body, "body", WIDE, 4),
    slot("cta.message", spec.slides.ctaMessage, "h2", CONTENT_WIDTH, 4),
  ];
}

export function layoutIds(_spec: PortfolioSpec, variant: PortfolioVariant): string[] {
  return variant === "story"
    ? ["pf-cover-story", "pf-process", "pf-decision", "pf-beforeafter", "pf-tech", "cta"]
    : ["pf-cover-showcase", "pf-challenge", "pf-approach-mock", "pf-result-check", "pf-tech", "cta"];
}

export function expectedPages(): number {
  return 6;
}

export function buildPages(
  spec: PortfolioSpec,
  theme: Theme,
  variant: PortfolioVariant = pickVariant(spec),
  assets?: TemplateRenderAssets,
): RenderedPage[] {
  return variant === "story" ? buildStory(spec, theme, assets) : buildShowcase(spec, theme, assets);
}

const MOCK_LINES = ["営業時間・アクセス", "サービス紹介", "お問い合わせフォーム"];

type ScreenshotMedia = { width: number; height: number };

/**
 * 許可済み実画像をデバイス風フレームへ配置する。実画像の縦横比を保って幅基準で縮小し、
 * 横方向のトリミングは一切行わない(横長スクリーンショットの見出し・カード切れを防ぐ)。
 * 縦に長すぎる画像だけmaxHeightを上限に上端基準で切り取る(HP画面は上部が最重要)。
 * フレーム高さは画像に追従する(固定高さにしない)。
 */
function screenshotMock(
  theme: Theme, dataUri: string, title: string, media: ScreenshotMedia, frameWidth = 360, maxHeight = 500,
): SatoriNode {
  const p = theme.colors;
  const headerH = 60;
  const innerW = frameWidth - 16; // border 8px×2
  const naturalH = Math.round((innerW * media.height) / media.width);
  const imageHeight = Math.min(maxHeight - headerH - 16, naturalH);
  const image: SatoriNode = {
    type: "img",
    props: {
      src: dataUri,
      width: innerW,
      height: imageHeight,
      style: { display: "flex", objectFit: "cover", objectPosition: "top" },
    },
  };
  return el("div", {
    display: "flex", flexDirection: "column", width: frameWidth, borderRadius: RADIUS.xl,
    backgroundColor: "#fff", border: `8px solid ${p.ink}`, overflow: "hidden",
    boxShadow: "0 20px 50px rgba(22,35,63,0.22)", flexShrink: 0,
  }, [
    el("div", {
      display: "flex", alignItems: "center", justifyContent: "center", height: headerH,
      flexShrink: 0, backgroundColor: p.primary, color: "#fff", fontSize: 22,
      fontWeight: 800, padding: "0 16px", textAlign: "center",
    }, title),
    image,
  ]);
}

/** 実画像+設計注釈。注釈が画面を隠さないよう左右分割する。 */
function annotatedScreenshot(theme: Theme, dataUri: string, media: ScreenshotMedia, notes: string[]): SatoriNode {
  const p = theme.colors;
  return el("div", { display: "flex", alignItems: "center", gap: SPACE.xl, width: "100%" }, [
    screenshotMock(theme, dataUri, "許可済みHP画面", media, 420, 520),
    el("div", { display: "flex", flexDirection: "column", gap: SPACE.md, flexGrow: 1 }, notes.slice(0, 4).map((note, i) =>
      el("div", {
        display: "flex", alignItems: "center", gap: SPACE.md, backgroundColor: p.primarySoft,
        borderRadius: RADIUS.md, padding: SPACE.md,
      }, [
        el("div", {
          width: 42, height: 42, borderRadius: 999, backgroundColor: p.primary, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
          fontWeight: 800, flexShrink: 0,
        }, String(i + 1)),
        el("div", { fontSize: 25, lineHeight: 1.45, fontWeight: 700, color: p.ink, display: "flex", whiteSpace: "pre-wrap" }, note),
      ]),
    )),
  ]);
}

function techPage(spec: PortfolioSpec, theme: Theme, cur: number, kicker = "担当範囲・使用技術"): RenderedPage {
  const p = theme.colors;
  return pg("pf-tech", page(theme, "soft", [
    header(theme, kicker),
    body([
      barHeading(theme, "h2", "使用した技術・担当範囲"),
      techTags(theme, spec.slides.tech.items),
      miniChecklist(theme, "Bloom-Lが一貫対応", ["企画・設計", "制作・実装", "公開・運用サポート"]),
      el("div", { display: "flex", flexDirection: "column", gap: SPACE.sm, backgroundColor: "#fff", borderRadius: RADIUS.lg, padding: SPACE.lg }, [
        el("div", { ...typeStyle("label"), color: p.primaryDark }, "制作の進め方"),
        ...["ヒアリングで現状と課題を整理", "設計案をご確認いただいてから制作", "公開後の更新・運用もサポート"].map((s) =>
          el("div", { display: "flex", alignItems: "center", gap: SPACE.md }, [
            iconCheck(p.primary, 36),
            el("div", { fontSize: 28, fontWeight: 700, color: p.ink, display: "flex" }, s),
          ])),
      ]),
    ], { gap: SPACE.lg, justify: "center" }),
    footer(theme, 6, cur),
  ]));
}

function ctaPg(spec: PortfolioSpec, theme: Theme): RenderedPage {
  return pg("cta", ctaPage(theme, spec.slides.ctaMessage, { badge: "DMで相談", sub: "「相談」とメッセージしてください" }, 6, 5));
}

// ---- showcase(完成物を見せる) ----
function buildShowcase(spec: PortfolioSpec, theme: Theme, assets?: TemplateRenderAssets): RenderedPage[] {
  const p = theme.colors;
  if (spec.portfolioMedia.mode !== "real_screenshot" || !assets?.portfolioImageDataUri) {
    throw new Error("showcaseは公開許可済みの実績スクリーンショットがある場合のみ生成できます");
  }
  const screenshot = assets.portfolioImageDataUri;
  const media: ScreenshotMedia = spec.portfolioMedia;
  const landscape = media.width >= media.height;
  const displayChip = el("div", { backgroundColor: p.primarySoft, color: p.primaryDark, fontSize: 26, fontWeight: 700, padding: "8px 20px", borderRadius: 999, alignSelf: "flex-start", display: "flex" }, spec.displayName);
  const coverTextCol = (width: number | string): SatoriNode =>
    el("div", { display: "flex", flexDirection: "column", gap: SPACE.md, width }, [
      tag(theme, "CASE STUDY", "soft"),
      text("h2", spec.slides.cover.title, { color: p.ink }),
      displayChip,
      text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
    ]);
  // 横長スクリーンショットは縦積み+幅広フレームで余白と切り取りを同時に防ぐ。縦長は従来の左右分割
  const coverBody = landscape
    ? [
        coverTextCol("100%"),
        el("div", { display: "flex", justifyContent: "center", width: "100%" }, [screenshotMock(theme, screenshot, "制作したHP", media, 640, 620)]),
        swipeHint(theme, 6),
      ]
    : [
        el("div", { display: "flex", gap: SPACE.xl, alignItems: "center", width: "100%" }, [
          coverTextCol(COVER_TEXT_W),
          el("div", { display: "flex", flexGrow: 1, justifyContent: "center" }, [screenshotMock(theme, screenshot, "制作したHP", media, 360, 620)]),
        ]),
        swipeHint(theme, 6),
      ];
  return [
    pg("pf-cover-showcase", page(theme, "white", [
      header(theme, "制作実績"),
      body(coverBody, { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, 6, 0, { cta: "DMで相談" }),
    ])),
    pg("pf-challenge", page(theme, "soft", [
      header(theme, "01 ・ 課題"),
      body([
        barHeading(theme, "h2", "ご相談時の課題"),
        quoteCard(theme, spec.slides.challenge.heading, spec.slides.challenge.body, "accent"),
        miniChecklist(theme, "お客様が困っていた点", ["営業時間外の連絡を受けとめられない", "情報がまとまっておらず伝わりにくい", "スマホで見づらく途中で離脱されやすい"]),
        el("div", { ...typeStyle("caption"), color: p.inkMuted }, "次のページで、どう対応したかを紹介します。"),
      ], { gap: SPACE.xl, justify: "center" }),
      footer(theme, 6, 1),
    ])),
    pg("pf-approach-mock", page(theme, "white", [
      header(theme, "02 ・ 対応・設計"),
      body([
        barHeading(theme, "h2", "画面と導線を設計"),
        annotatedScreenshot(theme, screenshot, media, ["スマホで見やすいレイアウト", "24時間の問い合わせフォーム", "サービス・実績を整理して掲載"]),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.inkMuted }, spec.slides.approach.body),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 2),
    ])),
    pg("pf-result-check", page(theme, "white", [
      header(theme, "03 ・ 設計でできること"),
      body([
        quoteCard(theme, spec.slides.result.heading, spec.slides.result.body, "primary"),
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          checkItem(theme, "営業時間外でも予約希望を記録できる", "primary"),
          checkItem(theme, "スマホから迷わず問い合わせできる", "primary"),
          checkItem(theme, "受けた内容を翌朝まとめて確認できる", "primary"),
        ]),
      ], { gap: SPACE.xl, justify: "center" }),
      footer(theme, 6, 3),
    ])),
    techPage(spec, theme, 4, "04 ・ 担当範囲・使用技術"),
    ctaPg(spec, theme),
  ];
}

// ---- story(課題→判断→設計→実装→確認) ----
function buildStory(spec: PortfolioSpec, theme: Theme, assets?: TemplateRenderAssets): RenderedPage[] {
  const p = theme.colors;
  const storyMedia: ScreenshotMedia | null = spec.portfolioMedia.mode === "real_screenshot" ? spec.portfolioMedia : null;
  const realScreenshot = storyMedia ? assets?.portfolioImageDataUri : undefined;
  return [
    pg("pf-cover-story", page(theme, "soft", [
      header(theme, "制作実績"),
      body([
        el("div", { display: "flex", flexDirection: "column", gap: SPACE.md }, [
          tag(theme, "CASE STUDY ・ ストーリー", "soft"),
          text("h2", spec.slides.cover.title, { color: p.ink }),
          // バッジと補足を横並びにするとバッジ内で「プレビュー」等が語中改行するため縦積みにする
          el("div", { backgroundColor: p.primarySoft, color: p.primaryDark, fontSize: 26, fontWeight: 700, padding: "8px 20px", borderRadius: 999, alignSelf: "flex-start", display: "flex" }, spec.displayName),
          text("lead", spec.slides.cover.subtitle, { color: p.inkMuted }),
        ]),
        el("div", { display: "flex", justifyContent: "center", width: "100%" }, [
          realScreenshot && storyMedia
            ? screenshotMock(theme, realScreenshot, "制作したHP", storyMedia, storyMedia.width >= storyMedia.height ? 640 : 360, 560)
            : deviceMock(theme, "設計イメージ", MOCK_LINES),
        ]),
        swipeHint(theme, 6),
      ], { gap: SPACE.lg, justify: "space-between" }),
      footer(theme, 6, 0, { cta: "DMで相談" }),
    ])),
    pg("pf-process", page(theme, "white", [
      header(theme, "制作プロセス"),
      body([
        barHeading(theme, "h2", "課題から公開までの流れ"),
        processFlow(theme, [
          { label: "課題", heading: spec.slides.challenge.heading },
          { label: "判断", heading: "スマホ対応と24時間受付を優先" },
          { label: "設計", heading: spec.slides.approach.heading },
          { label: "実装", heading: "フォーム・導線を実装" },
          { label: "確認", heading: spec.slides.result.heading },
        ]),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 1),
    ])),
    pg("pf-decision", page(theme, "soft", [
      header(theme, "設計の判断"),
      body([
        barHeading(theme, "h2", "なぜこの設計にしたか"),
        splitTwo(theme,
          { label: "課題", text: spec.slides.challenge.body, tone: "accent" },
          { label: "対応・設計", text: spec.slides.approach.heading, tone: "primary" },
        ),
        el("div", { ...typeStyle("body", { whiteSpace: "pre-wrap" }), color: p.ink }, spec.slides.approach.body),
      ], { gap: SPACE.lg, justify: "center" }),
      footer(theme, 6, 2),
    ])),
    pg("pf-beforeafter", page(theme, "white", [
      header(theme, "設計で変わる受け方"),
      body([
        barHeading(theme, "h2", "対応前 と 設計後"),
        // 紫苑QA(v8)対応: カードを縦に分散配置して空白帯をなくす(密度を他ページと揃える)
        el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "space-around" }, [
          beforeAfterCard(theme, "電話のみで受付", "24時間フォームで受付"),
          beforeAfterCard(theme, "情報が探しにくい", "1か所に整理して掲載"),
          beforeAfterCard(theme, "更新が後回しになる", "更新しやすい仕組みで運用"),
          el("div", { ...typeStyle("caption"), color: p.inkMuted }, "架空事例のデモです。成果数値・顧客評価は生成していません。" ),
        ]),
      ], { gap: SPACE.md, justify: "flex-start" }),
      footer(theme, 6, 3),
    ])),
    techPage(spec, theme, 4),
    ctaPg(spec, theme),
  ];
}
