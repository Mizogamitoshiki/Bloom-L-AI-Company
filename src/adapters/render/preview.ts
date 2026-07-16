/**
 * ゴールデンプレビュー生成(V4.5 v2 §5/§6)。4系統×全variantを固定fixtureでレンダリングし、
 * variantごとの全ページPNG・contact sheet(270×338相当)・meta、系統横断の8表紙overviewを出力する。
 * content QA(禁止語+無根拠な成果断定)・mechanical design QAを保存する(visual QAは別途 紫苑が付与)。
 * fixtureは架空データとして各PNGにラベルを合成し、実在情報・実績に見せない。テンプレートは自己承認しない。
 */
import sharp, { type OverlayOptions } from "sharp";
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import type { CarouselSpec, DesignQaResult } from "../../core/schemas";
import { carouselSpecSchema } from "../../core/schemas";
import { templateFor, TEMPLATES } from "../../core/templates/index";
import { CANVAS, DESIGN_SYSTEM_VERSION, CAROUSEL_SCHEMA_VERSION } from "../../core/templates/design-system";
import { distinctInteriorPageCount, MIN_DISTINCT_INTERIOR_PAGES } from "../../core/templates/distinctness";
import { renderCarousel } from "./renderer";
import { runDesignQa } from "./design-qa";
import { loadTheme } from "./theme";
import { loadForbiddenPhrases } from "../config";
import { scanForbidden, scanUnsupportedClaims } from "../../core/guards";
import type { PortfolioMedia } from "../../core/schemas";
import type { TemplateRenderAssets } from "../../core/templates/index";

/** 実運用に近い固定fixture(架空データのみ・成果は断定せず設計/導線として表現)。 */
export const PREVIEW_SPECS: CarouselSpec[] = [
  carouselSpecSchema.parse({
    kind: "carousel_spec", templateId: "tpl-howto", pillar: "6", sourceCopyArtifactId: "preview-howto",
    slides: {
      cover: { title: "HPがなくても始める見せ方", subtitle: "泉州の事業者さま向け・保存版" },
      pages: [
        { heading: "情報を1か所に集める", body: "営業時間・場所・サービス・実績を、まず1か所にまとめます。お客様が迷わずたどり着ける状態を作ります。", example: "例) Googleビジネスや無料プロフィールに基本情報を記載" },
        { heading: "写真で信頼を伝える", body: "店内・作業風景・スタッフの写真を数枚。文字だけより、雰囲気が伝わりやすくなります。", example: "準備するもの) スマホで撮った明るい写真3〜5枚" },
        { heading: "問い合わせ導線を作る", body: "電話・LINE・フォームなど、連絡手段をわかりやすく置きます。反応を見ながらHPへ発展させます。", example: "完了状態) 1タップで連絡できるボタンが常に見える" },
      ],
      ctaMessage: "この3ステップから始めれば、HPがなくても「見つけてもらう」準備が整います。",
    },
  }),
  carouselSpecSchema.parse({
    kind: "carousel_spec", templateId: "tpl-news", pillar: "1", sourceCopyArtifactId: "preview-news",
    slides: {
      cover: { title: "検索にAI回答が増えています", subtitle: "泉州の事業者さまへの影響を解説" },
      facts: [
        { text: "大手検索サービスで、AIが要約した回答が結果の上部に表示される範囲が広がっています。" },
        { text: "利用者は結果を開く前に、要約された答えを目にする機会が増えています。" },
      ],
      opinion: { heading: "構造的に整えたHPが有利", body: "情報を項目ごとに整理したHPほど、AIにも人にも正しく伝わりやすい、というのが私たちの見方です。" },
      impact: { heading: "掲載情報の整理が重要に", body: "営業時間・サービス内容・実績を整理して掲載しておくことが、これまで以上に大切になりそうです。" },
      ctaMessage: "自社の場合はどうなる?と思ったら、プロフィールから詳しくご覧ください。",
    },
    sourceRefs: [
      { title: "大手検索サービスがAI回答表示を拡大", publisher: "架空ITニュース(プレビュー)", publishedAt: "2026-07-10" },
      { title: "AI検索と中小事業者の可視性に関する調査", publisher: "架空リサーチ(プレビュー)", publishedAt: "2026-06-28" },
    ],
  }),
  carouselSpecSchema.parse({
    kind: "carousel_spec", templateId: "tpl-portfolio", pillar: "5", sourceCopyArtifactId: "preview-portfolio",
    slides: {
      cover: { title: "時間外の予約を受けられるHP", subtitle: "スマホ対応と問い合わせ導線の設計" },
      challenge: { heading: "電話予約のみの受付だった", body: "電話でしか予約を受けられず、営業時間外の予約希望を受けとめる導線がありませんでした。" },
      approach: { heading: "スマホ最適化と24hフォーム", body: "スマホで見やすいHPに、24時間受け付けられる問い合わせフォームを設置しました。" },
      result: { heading: "時間外も受けられる構成に", body: "営業時間外でも予約希望を記録できるフォーム導線を設計し、翌朝そのまま折り返せる構成にしました。" },
      tech: { items: ["Next.js", "問い合わせフォーム", "スマホ対応", "予約導線"] },
      ctaMessage: "同じお悩みがあれば、DMで「相談」とお送りください。",
    },
    displayName: "架空事例(プレビュー)", anonymous: true,
  }),
  carouselSpecSchema.parse({
    kind: "carousel_spec", templateId: "tpl-compare", pillar: "2", sourceCopyArtifactId: "preview-compare",
    slides: {
      cover: { title: "HP導入で何が変わる?", subtitle: "導入前後をセルフ診断でチェック" },
      intro: { heading: "5つの観点で比較", body: "集客・信頼・問い合わせ・営業時間外対応・情報更新の5点で、HP導入前後を比べます。" },
      rows: [
        { before: "紹介と口コミ頼み", after: "検索から見つけてもらう" },
        { before: "電話のみの受付", after: "24時間フォーム受付" },
        { before: "情報が探しにくい", after: "1か所に整理して掲載" },
        { before: "時間外は受けとめ不可", after: "時間外も予約を記録" },
      ],
      verdict: { heading: "当てはまるほど余地が大きい", body: "3つ以上当てはまるなら、HPで解決できる余地が大きい状態です。まずは無料相談から。" },
      ctaMessage: "診断に使えるので、保存して見返してください。",
    },
  }),
];

export interface ContentQa { result: "pass" | "fail"; issues: string[] }

export interface PreviewVariantMeta {
  templateId: string;
  family: string;
  version: number;
  variant: string;
  fingerprint: string;
  pageCount: number;
  status: string;
  files: string[];
  contactSheet: string;
  layoutIds: string[];
  pageHashes: string[];
  contentQa: ContentQa;
  designQa: DesignQaResult;
  visualQa: unknown | null; // 生成時null。template-visual-qa後にDBと同じ結果を反映(整合)
  tokens: { designSystem: string; schema: string; canvas: string };
  rights: string;
  fixtureKind: "fictional" | "real";
  generatedNote: string;
}

/** Bloom-L所有の架空HP画面。第三者素材を使わず、実画像差し込み経路をプレビューする。 */
async function portfolioPreviewFixture(): Promise<{
  media: Extract<PortfolioMedia, { mode: "real_screenshot" }>;
  assets: TemplateRenderAssets;
}> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <rect width="1200" height="900" fill="#f7f9fd"/>
    <rect width="1200" height="110" fill="#0b46b8"/>
    <text x="70" y="72" font-family="sans-serif" font-size="40" font-weight="700" fill="#fff">SENSHU SAMPLE STUDIO</text>
    <rect x="70" y="165" width="1060" height="250" rx="28" fill="#dfe9fb"/>
    <rect x="110" y="215" width="510" height="42" rx="12" fill="#0b46b8"/>
    <rect x="110" y="285" width="390" height="24" rx="12" fill="#7f91b5"/>
    <rect x="110" y="330" width="450" height="24" rx="12" fill="#a9b7d1"/>
    <rect x="790" y="210" width="250" height="145" rx="24" fill="#ffffff" stroke="#0b46b8" stroke-width="8"/>
    <rect x="70" y="475" width="320" height="250" rx="24" fill="#ffffff" stroke="#d6e0f1" stroke-width="4"/>
    <rect x="440" y="475" width="320" height="250" rx="24" fill="#ffffff" stroke="#d6e0f1" stroke-width="4"/>
    <rect x="810" y="475" width="320" height="250" rx="24" fill="#ffffff" stroke="#d6e0f1" stroke-width="4"/>
    <circle cx="230" cy="555" r="52" fill="#e8a13a"/>
    <circle cx="600" cy="555" r="52" fill="#0b46b8"/>
    <circle cx="970" cy="555" r="52" fill="#1f8a4c"/>
    <rect x="135" y="645" width="190" height="20" rx="10" fill="#566180"/>
    <rect x="505" y="645" width="190" height="20" rx="10" fill="#566180"/>
    <rect x="875" y="645" width="190" height="20" rx="10" fill="#566180"/>
    <rect x="370" y="785" width="460" height="68" rx="34" fill="#0b46b8"/>
    <text x="485" y="831" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff">お問い合わせはこちら</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").png().toBuffer();
  const assetSha256 = createHash("sha256").update(png).digest("hex");
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  return {
    media: {
      mode: "real_screenshot",
      assetSha256,
      mimeType: "image/png",
      width: 1200,
      height: 900,
      safeRelativePath: "06_template-previews/_fixtures/bloom-owned-fictional-site.png",
    },
    assets: { portfolioImageDataUri: dataUri, portfolioAssetSha256: assetSha256 },
  };
}

/** specの公開テキストを集める */
function collectText(spec: CarouselSpec): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(spec.slides);
  if ("sourceRefs" in spec) walk(spec.sourceRefs);
  return parts.join("\n");
}

/**
 * content QA(通常コード): 禁止語 + 無根拠な成果断定。
 * ニュース(出典あり)の外部トレンド言及は出典を根拠とみなす(hasEvidence)。
 * 実績・howto・比較(事業者自身の成果)は根拠がなければ設計・導線として表現させる。
 */
function contentQa(spec: CarouselSpec): ContentQa {
  const text = collectText(spec);
  const hasEvidence = "sourceRefs" in spec && Array.isArray(spec.sourceRefs) && spec.sourceRefs.length > 0;
  const forbidden = scanForbidden(text, loadForbiddenPhrases()).map((h) => `禁止表現(${h.label}): ${h.sample}`);
  const claims = scanUnsupportedClaims(text, hasEvidence).map((c) => `無根拠な成果断定: ${c}`);
  const issues = [...forbidden, ...claims];
  return { result: issues.length === 0 ? "pass" : "fail", issues };
}

/** 架空データのラベル帯をPNGへ合成する(実在情報・実績に見せない) */
async function labelBuffer(): Promise<Buffer> {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${CANVAS.width}' height='64'><rect width='100%' height='64' fill='#16233f' opacity='0.86'/><text x='24' y='42' font-family='sans-serif' font-size='30' font-weight='700' fill='#ffffff'>PREVIEW ・ プレビュー用の架空データ(実在情報・実績ではありません)</text></svg>`;
  return Buffer.from(svg);
}

/** contact sheet(270×338サムネイル、3列) */
async function contactSheet(files: string[], outFile: string): Promise<void> {
  const TW = 270, TH = 338, GAP = 14, COLS = 3;
  const rows = Math.ceil(files.length / COLS);
  const W = COLS * TW + (COLS + 1) * GAP, H = rows * TH + (rows + 1) * GAP;
  const composites: OverlayOptions[] = [];
  for (let i = 0; i < files.length; i++) {
    const buf = await sharp(files[i]!).resize(TW, TH).png().toBuffer();
    composites.push({ input: buf, left: GAP + (i % COLS) * (TW + GAP), top: GAP + Math.floor(i / COLS) * (TH + GAP) });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#dfe6f0" } }).composite(composites).png().toFile(outFile);
}

/**
 * 4系統×全variantのゴールデンプレビューを生成する。
 * @param opts.version 版番号、opts.statusOf 承認状態解決関数
 */
export async function generateTemplatePreviews(
  outRoot: string,
  opts: { version?: number; statusOf?: (templateId: string) => string } = {},
): Promise<PreviewVariantMeta[]> {
  const version = opts.version ?? 1;
  const theme = loadTheme();
  const results: PreviewVariantMeta[] = [];
  const coverThumbs: string[] = [];
  const label = await labelBuffer();
  const portfolioFixture = await portfolioPreviewFixture();

  for (const spec of PREVIEW_SPECS) {
    const tpl = templateFor(spec.templateId);
    const variants = (TEMPLATES as Record<string, { variants: readonly string[] }>)[spec.templateId]!.variants;
    for (const variant of variants) {
      const variantSpec = carouselSpecSchema.parse({
        ...spec,
        layoutVariant: variant,
        ...(spec.templateId === "tpl-portfolio" ? { portfolioMedia: portfolioFixture.media } : {}),
      });
      const dir = path.join(outRoot, spec.templateId, `v${version}`, variant);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      const render = await renderCarousel(variantSpec, dir, {
        templateVersion: version,
        ...(spec.templateId === "tpl-portfolio" ? { assets: portfolioFixture.assets } : {}),
      });
      // 架空データラベルを各ページへ合成(元は上書き)
      for (let i = 0; i < render.files.length; i++) {
        const f = render.files[i]!;
        const withLabel = await sharp(f)
          .composite([{ input: label, top: 0, left: 0 }])
          .flatten({ background: "#ffffff" })
          .removeAlpha()
          .toColourspace("srgb")
          .png()
          .toBuffer();
        writeFileSync(f, withLabel);
        // previewの差分判定は、ラベル合成後の最終公開候補バイト列を根拠にする
        render.pageHashes[i] = createHash("sha256").update(withLabel).digest("hex");
      }
      const designQa = await runDesignQa(variantSpec, {
        files: render.files, pageCount: render.pageCount, variant: render.variant, fingerprint: render.fingerprint, templateVersion: version,
        embeddedAssetSha256: render.embeddedAssetSha256,
      }, theme);
      const cqa = contentQa(variantSpec);
      const sheet = path.join(dir, "contact-sheet.png");
      await contactSheet(render.files, sheet);
      coverThumbs.push(render.files[0]!);

      const meta: PreviewVariantMeta = {
        templateId: spec.templateId, family: tpl.family, version, variant: render.variant, fingerprint: render.fingerprint,
        pageCount: render.pageCount, status: opts.statusOf?.(spec.templateId) ?? "draft",
        files: render.files.map((f) => path.basename(f)), contactSheet: path.basename(sheet),
        layoutIds: render.layoutIds, pageHashes: render.pageHashes,
        contentQa: cqa, designQa, visualQa: null,
        tokens: { designSystem: DESIGN_SYSTEM_VERSION, schema: CAROUSEL_SCHEMA_VERSION, canvas: `${CANVAS.width}x${CANVAS.height}` },
        rights: theme.logo
          ? `Bloom-L所有のロゴ・カラー・Noto Sans JP(SIL OFL 1.1)。第三者素材なし${spec.templateId === "tpl-portfolio" ? "。Bloom-L所有の架空HP画面fixture" : ""}`
          : "ロゴ未検出",
        fixtureKind: "fictional",
        generatedNote: "固定fixtureによるゴールデンプレビュー(架空データ)。全variantのQA合格+代表者承認まで公開不可。",
      };
      writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
      results.push(meta);
    }
  }

  // 8表紙overview(系統×variantを4列×2行)
  const OW = 270, OH = 338, GAP = 14, COLS = 4;
  const rows = Math.ceil(coverThumbs.length / COLS);
  const composites: OverlayOptions[] = [];
  for (let i = 0; i < coverThumbs.length; i++) {
    const buf = await sharp(coverThumbs[i]!).resize(OW, OH).png().toBuffer();
    composites.push({ input: buf, left: GAP + (i % COLS) * (OW + GAP), top: GAP + Math.floor(i / COLS) * (OH + GAP) });
  }
  mkdirSync(outRoot, { recursive: true });
  await sharp({ create: { width: COLS * OW + (COLS + 1) * GAP, height: rows * OH + (rows + 1) * GAP, channels: 3, background: "#dfe6f0" } })
    .composite(composites).png().toFile(path.join(outRoot, "overview.png"));

  // family別のvariant差分(01〜05で異なるlayoutId かつ 画像ハッシュ相違のページ数)
  const families = [...new Set(results.map((r) => r.templateId))].map((templateId) => {
    const vs = results.filter((r) => r.templateId === templateId);
    const distinct = vs.length === 2 ? distinctInteriorPageCount(
      { layoutIds: vs[0]!.layoutIds, pageHashes: vs[0]!.pageHashes },
      { layoutIds: vs[1]!.layoutIds, pageHashes: vs[1]!.pageHashes },
    ) : 0;
    return { templateId, family: vs[0]!.family, variants: vs.map((v) => v.variant), distinctInteriorPages: distinct, distinctOk: distinct >= MIN_DISTINCT_INTERIOR_PAGES };
  });

  // v2↔v3 比較画像(version 3 生成時、v2の8表紙 と v3の8表紙 を上下に並べる)
  if (version >= 3) await buildComparison(outRoot, version);

  writeFileSync(path.join(outRoot, "index.json"), JSON.stringify({
    version, generatedNote: `V4.5 golden previews v${version}(4系統×2variant)`,
    families,
    variants: results.map((r) => ({ templateId: r.templateId, family: r.family, variant: r.variant, status: r.status, fingerprint: r.fingerprint, contentQa: r.contentQa.result, designQa: r.designQa.result, fixtureKind: r.fixtureKind, layoutIds: r.layoutIds })),
  }, null, 2));

  return results;
}

/** v2の8表紙 と v(N)の8表紙 を上下に並べた比較画像を作る(v2が存在する場合) */
async function buildComparison(outRoot: string, version: number): Promise<void> {
  const OW = 240, OH = 300, GAP = 12, COLS = 4;
  const collect = (v: number): string[] => {
    const files: string[] = [];
    for (const [id, variants] of Object.entries({ "tpl-howto": ["steps", "guide"], "tpl-news": ["report", "insight"], "tpl-portfolio": ["showcase", "story"], "tpl-compare": ["table", "diagnosis"] })) {
      for (const variant of variants) {
        const f = v === 2 ? path.join(outRoot, id, "v2", variant, "01.png") : path.join(outRoot, id, `v${v}`, variant, "01.png");
        if (existsSync(f)) files.push(f);
      }
    }
    return files;
  };
  const v2 = collect(2), vN = collect(version);
  if (v2.length !== 8 || vN.length !== 8) return; // v2が無ければ比較しない
  const rowY = (band: number): number => GAP + band * (OH + 40 + GAP);
  const composites: OverlayOptions[] = [];
  const label = (t: string, y: number): OverlayOptions => ({ input: Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='32'><text x='0' y='26' font-family='sans-serif' font-size='26' font-weight='700' fill='#16233f'>${t}</text></svg>`), left: GAP, top: y });
  composites.push(label("v2(表紙)", rowY(0) - 4));
  for (let i = 0; i < 8; i++) composites.push({ input: await sharp(v2[i]!).resize(OW, OH).png().toBuffer(), left: GAP + (i % COLS) * (OW + GAP), top: rowY(0) + 34 + Math.floor(i / COLS) * (OH + GAP) });
  const band1Top = rowY(0) + 34 + 2 * (OH + GAP) + 20;
  composites.push(label(`v${version}(表紙)`, band1Top - 4));
  for (let i = 0; i < 8; i++) composites.push({ input: await sharp(vN[i]!).resize(OW, OH).png().toBuffer(), left: GAP + (i % COLS) * (OW + GAP), top: band1Top + 34 + Math.floor(i / COLS) * (OH + GAP) });
  const W = COLS * OW + (COLS + 1) * GAP;
  const H = band1Top + 34 + 2 * (OH + GAP) + GAP;
  await sharp({ create: { width: W, height: H, channels: 3, background: "#eef2f9" } }).composite(composites).png().toFile(path.join(outRoot, "v2-v3-comparison.png"));
}

/** template-visual-qa後にmeta.jsonへvisual QAを反映(DBとmeta.jsonの整合) */
export function reconcileVisualQaInMeta(outRoot: string, templateId: string, version: number, variant: string, visualQa: unknown): void {
  const metaPath = path.join(outRoot, templateId, `v${version}`, variant, "meta.json");
  if (!existsSync(metaPath)) return;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  meta.visualQa = visualQa;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}
