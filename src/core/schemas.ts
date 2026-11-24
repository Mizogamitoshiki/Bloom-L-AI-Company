/**
 * Zodスキーマ — 全成果物・イベントペイロードの唯一の検証定義(docs/07 D-08)。
 * DBへの書き込みはこの検証を通過したものだけ(company CLI / UIユースケース経由)。
 */
import { z } from "zod";
import { EVENT_TYPES, TASK_TYPES, MODEL_PROFILES } from "./domain";

export const SCHEMA_VERSION = "v1";

/** イベントペイロード: 個人情報・秘密情報を含めない(docs/13)。自由文はstage/reasonの短文のみ */
export const eventPayloadSchema = z
  .object({
    stage: z.string().max(80).optional(),
    reason: z.string().max(200).optional(),
    artifactId: z.string().max(40).optional(),
    retryCount: z.number().int().min(0).max(10).optional(),
  })
  .strict();
export type EventPayload = z.infer<typeof eventPayloadSchema>;

export const eventTypeSchema = z.enum(EVENT_TYPES);

/** パイプライン内のステップを識別する安定キー(例: "copy-v1", "qa")。冪等キーの一部になる */
const stepKeySchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, "stepKeyは英数字・ハイフン・アンダースコアのみ")
  .max(60);

/**
 * タスク作成入力(手動create-task用)。
 * stepKeyは任意 — 省略時はtitle先頭40文字にフォールバックする。
 * kickoff等の自動生成では plannedTaskSpecSchema(stepKey必須)を使うこと。
 */
export const taskSpecSchema = z
  .object({
    type: z.enum(TASK_TYPES),
    title: z.string().min(1).max(120),
    assigneeId: z.string().min(1),
    postId: z.string().optional(),
    stepKey: stepKeySchema.optional(),
    priority: z.number().int().min(0).max(9).default(5),
    input: z.record(z.unknown()).optional(),
  })
  .strict();
export type TaskSpec = z.infer<typeof taskSpecSchema>;

/**
 * kickoff/plan-commit用タスク仕様: stepKey必須。
 * 自動生成タスクの冪等キー衝突(同名別ステップ・別投稿の統合)をスキーマで構造的に防ぐ。
 */
export const plannedTaskSpecSchema = taskSpecSchema.extend({
  stepKey: stepKeySchema,
});
export type PlannedTaskSpec = z.infer<typeof plannedTaskSpecSchema>;

export const planCommitSchema = z
  .object({
    runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tasks: z.array(plannedTaskSpecSchema).max(20), // limits.daily.max_tasks と整合
  })
  .strict();

// ---- 成果物スキーマ(kind別) ----

/** 汎用ノート(調査メモ・議事要旨など、V1の最小成果物) */
export const noteArtifactSchema = z
  .object({
    kind: z.literal("note"),
    title: z.string().min(1).max(120),
    body: z.string().min(1).max(8000),
  })
  .strict();

/** 投稿企画(docs/05 昊の出力) */
export const postPlanArtifactSchema = z
  .object({
    kind: z.literal("post_plan"),
    theme: z.string().min(1).max(120),
    pillar: z.enum(["1", "2", "3", "4", "5", "6"]),
    format: z.enum(["carousel", "video_script", "image", "faq", "checklist"]),
    target: z.string().min(1).max(200),
    outline: z.array(z.string().min(1).max(200)).min(1).max(10),
    ctaIdea: z.string().min(1).max(200),
    sourceIds: z.array(z.string()).max(10).default([]),
    /** V6-E: CEO承認済み改善指示の採用記録(任意・最大3件)。採用理由を企画成果物へ残す */
    appliedImprovements: z
      .array(z.object({ proposalId: z.string().min(1).max(40), reason: z.string().min(1).max(300) }).strict())
      .max(3)
      .optional(),
  })
  .strict();
export type PostPlan = z.infer<typeof postPlanArtifactSchema>;

/**
 * カルーセルのスライド文言(tpl-howto用スロット)。
 * 文字数上限は Noto Sans JP での実測(セーフエリア64px・所定フォントサイズ)に基づく第1層の文字あふれ防止。
 * 第2層はレンダラーのSatori実測(measureSlotOverflows)。
 */
export const slidesSchema = z
  .object({
    cover: z
      .object({
        title: z.string().min(4).max(26),
        subtitle: z.string().max(36),
      })
      .strict(),
    pages: z
      .array(
        z
          .object({
            heading: z.string().min(2).max(20),
            body: z.string().min(4).max(90),
            /** V4.5 v3: 具体例/入力例/完了状態(任意。stepsで情報モジュールとして表示) */
            example: z.string().min(2).max(54).optional(),
          })
          .strict(),
      )
      .min(3)
      .max(6),
    ctaMessage: z.string().min(4).max(60),
  })
  .strict();
export type Slides = z.infer<typeof slidesSchema>;

/** キャプション+スライド文言(docs/05 琴葉の出力) */
export const copyArtifactSchema = z
  .object({
    kind: z.literal("copy"),
    headline: z.string().min(4).max(40),
    body: z.string().min(10).max(1800),
    cta: z.string().min(4).max(120),
    hashtags: z.array(z.string().regex(/^#\S+$/).max(40)).min(5).max(15),
    slides: slidesSchema,
  })
  .strict();
export type Copy = z.infer<typeof copyArtifactSchema>;

// ---- テンプレート別スライド(V3-D) ----

const headingBody = z.object({ heading: z.string().min(2).max(20), body: z.string().min(4).max(90) }).strict();
const coverSchema = z.object({ title: z.string().min(4).max(26), subtitle: z.string().max(36) }).strict();

/** tpl-news: 事実(facts)とBloom-Lの見解(opinion)を分離した構造 */
export const newsSlidesSchema = z
  .object({
    cover: coverSchema,
    facts: z.array(z.object({ text: z.string().min(4).max(90) }).strict()).min(2).max(4),
    opinion: headingBody, // Bloom-Lの見解(事実と分離して表示)
    impact: headingBody, // 事業者への影響
    ctaMessage: z.string().min(4).max(60),
  })
  .strict();

export const newsCopyArtifactSchema = z
  .object({
    kind: z.literal("news_copy"),
    headline: z.string().min(4).max(40),
    body: z.string().min(10).max(1800),
    cta: z.string().min(4).max(120),
    hashtags: z.array(z.string().regex(/^#\S+$/).max(40)).min(5).max(15),
    slides: newsSlidesSchema,
  })
  .strict();
export type NewsCopy = z.infer<typeof newsCopyArtifactSchema>;

/** tpl-portfolio: 課題→対応→成果→技術→CTA */
export const portfolioSlidesSchema = z
  .object({
    cover: coverSchema,
    challenge: headingBody,
    approach: headingBody,
    result: headingBody,
    tech: z.object({ items: z.array(z.string().min(1).max(16)).min(1).max(6) }).strict(),
    ctaMessage: z.string().min(4).max(60),
  })
  .strict();

export const portfolioCopyArtifactSchema = z
  .object({
    kind: z.literal("portfolio_copy"),
    headline: z.string().min(4).max(40),
    body: z.string().min(10).max(1800),
    cta: z.string().min(4).max(120),
    hashtags: z.array(z.string().regex(/^#\S+$/).max(40)).min(5).max(15),
    slides: portfolioSlidesSchema,
  })
  .strict();
export type PortfolioCopy = z.infer<typeof portfolioCopyArtifactSchema>;

/**
 * カルーセル仕様(レンダラー入力。通常コードが構築する)。templateIdで判別されるunion。
 * sourceCopyArtifactId: 入力になったコピー成果物の不変ID(QA整合性ゲートの根拠)。
 */
const specBase = {
  kind: z.literal("carousel_spec"),
  pillar: z.enum(["1", "2", "3", "4", "5", "6"]),
  sourceCopyArtifactId: z.string().min(1),
  /** V4.5: 系統内のlayout variant(決定的に選択。無制限なAI自由配置はしない) */
  layoutVariant: z.string().min(1).max(24).optional(),
} as const;

/** tpl-compare: HP導入前後・よくある失敗・セルフ診断・比較(V4.5 comparison/checklist系統) */
export const compareSlidesSchema = z
  .object({
    cover: coverSchema,
    intro: headingBody, // 何を比較/診断するか
    rows: z
      .array(z.object({ before: z.string().min(2).max(28), after: z.string().min(2).max(28) }).strict())
      .min(3)
      .max(5),
    verdict: headingBody, // 読者が次に取れる結論
    ctaMessage: z.string().min(4).max(60),
  })
  .strict();

export const compareCopyArtifactSchema = z
  .object({
    kind: z.literal("compare_copy"),
    headline: z.string().min(4).max(40),
    body: z.string().min(10).max(1800),
    cta: z.string().min(4).max(120),
    hashtags: z.array(z.string().regex(/^#\S+$/).max(40)).min(5).max(15),
    slides: compareSlidesSchema,
  })
  .strict();
export type CompareCopy = z.infer<typeof compareCopyArtifactSchema>;

export const howtoSpecSchema = z
  .object({ ...specBase, templateId: z.literal("tpl-howto"), slides: slidesSchema })
  .strict();

/** sourceRefsはDBに登録済みのsourcesから通常コードが構築する(AIが出典を書かない) */
export const newsSpecSchema = z
  .object({
    ...specBase,
    templateId: z.literal("tpl-news"),
    slides: newsSlidesSchema,
    sourceRefs: z
      .array(
        z.object({ title: z.string().min(1).max(80), publisher: z.string().min(1).max(40), publishedAt: z.string().max(10) }).strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

/**
 * 実績画像の追跡情報。画像本体(data URI)はDBへ保存せず、通常コードがレンダリング中だけ渡す。
 * 既存carousel_specとの互換性のため、PortfolioSpecではabstractをdefaultにする。
 */
export const portfolioMediaSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("abstract") }).strict(),
  z
    .object({
      mode: z.literal("real_screenshot"),
      assetSha256: z.string().regex(/^[a-f0-9]{64}$/),
      mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      width: z.number().int().min(320).max(12_000),
      height: z.number().int().min(320).max(12_000),
      safeRelativePath: z.string().min(1).max(300),
    })
    .strict(),
]);
export type PortfolioMedia = z.infer<typeof portfolioMediaSchema>;

/** displayName・mediaは許可状態から通常コードが決定する(AIが顧客名/素材を指定しない) */
export const portfolioSpecSchema = z
  .object({
    ...specBase,
    templateId: z.literal("tpl-portfolio"),
    slides: portfolioSlidesSchema,
    displayName: z.string().min(1).max(30),
    anonymous: z.boolean(),
    portfolioMedia: portfolioMediaSchema.default({ mode: "abstract" }),
  })
  .strict();

export const compareSpecSchema = z
  .object({ ...specBase, templateId: z.literal("tpl-compare"), slides: compareSlidesSchema })
  .strict();

// ---- V10: サイトサンプル(docs/32) ----

export const PLAN_IDS = ["ume", "take", "matsu"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const SAMPLE_PERSONAS = ["P1", "P2", "P3"] as const;
/** 代表者が投入する素材の種別。design=忠実再現の対象、reference=雰囲気の参考(画面に出さない) */
export const SAMPLE_ASSET_KINDS = ["design", "hero", "logo", "photo", "reference"] as const;
export type SampleAssetKind = (typeof SAMPLE_ASSET_KINDS)[number];
export const SAMPLE_REQUEST_STATUSES = ["new", "building", "qa", "ready", "posted", "declined"] as const;
export type SampleRequestStatus = (typeof SAMPLE_REQUEST_STATUSES)[number];
export const SAMPLE_SCREENSHOT_NAMES = ["pc-fold", "pc-full", "sp-fold", "sp-full"] as const;
export type SampleScreenshotName = (typeof SAMPLE_SCREENSHOT_NAMES)[number];

/** 代表者のサンプル依頼(intake)。attest=素材の権利宣言(必須・falseは受け付けない) */
export const sampleRequestInputSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/, "slugは英小文字・数字・ハイフン(3〜40字)"),
    siteTitle: z.string().max(40).optional(),
    industry: z.string().min(1).max(80),
    persona: z.enum(SAMPLE_PERSONAS),
    planTarget: z.enum([...PLAN_IDS, "auto"]).default("auto"),
    pages: z.array(z.string().min(1).max(20)).min(1).max(3).default(["TOP"]),
    brief: z.string().max(1000).default(""),
    attest: z.literal(true, {
      errorMap: () => ({ message: "素材の権利宣言(attest=true)が必要です。自分が権利を持つデザイン・素材のみ投入できます" }),
    }),
  })
  .strict();
export type SampleRequestInput = z.infer<typeof sampleRequestInputSchema>;

export const sampleAssetInputSchema = z
  .object({
    fileName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.(png|jpg|jpeg|webp)$/i, "素材ファイル名は英数字とpng/jpg/webpのみ"),
    kind: z.enum(SAMPLE_ASSET_KINDS),
  })
  .strict();
export type SampleAssetInput = z.infer<typeof sampleAssetInputSchema>;

export const SITE_SAMPLE_LIMITS = { maxHtmlChars: 200_000, maxCssChars: 100_000, maxPages: 3, maxAssets: 10 } as const;

/**
 * 颯(Web制作担当)の成果物: サンプルサイトのHTML/CSS(V10)。
 * ファイル書込・撮影は通常コード(sample-build)が行う。外部URL/JS/実在情報/価格は通常コードが検査して拒否する。
 */
export const siteSampleArtifactSchema = z
  .object({
    kind: z.literal("site_sample"),
    requestId: z.string().min(1).max(40),
    siteTitle: z.string().min(1).max(40),
    concept: z.string().min(1).max(120),
    pages: z
      .array(
        z
          .object({
            path: z.string().regex(/^[a-z0-9-]+\.html$/, "ページ名は英小文字・数字・ハイフン+.html"),
            title: z.string().min(1).max(80),
            html: z.string().min(1).max(SITE_SAMPLE_LIMITS.maxHtmlChars),
          })
          .strict(),
      )
      .min(1)
      .max(SITE_SAMPLE_LIMITS.maxPages),
    css: z.string().max(SITE_SAMPLE_LIMITS.maxCssChars),
    assetsUsed: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/)).max(SITE_SAMPLE_LIMITS.maxAssets).default([]),
    planFit: z.enum(PLAN_IDS),
    planFitReason: z.string().min(1).max(200),
    notes: z.array(z.string().max(200)).max(10).default([]),
  })
  .strict()
  .refine((s) => s.pages.some((p) => p.path === "index.html"), { message: "index.html が必要です" })
  .refine((s) => new Set(s.pages.map((p) => p.path)).size === s.pages.length, { message: "ページ名が重複しています" });
export type SiteSampleArtifact = z.infer<typeof siteSampleArtifactSchema>;

/** tpl-sample: 表紙→場面→画面(SP)→画面(PC)→制作の裏側→プラン提案(価格帯は通常コード注入)→CTA */
export const sampleSlidesSchema = z
  .object({
    cover: coverSchema,
    scene: headingBody,
    screens: z.array(z.object({ caption: z.string().min(2).max(40) }).strict()).length(2),
    behind: headingBody,
    /** 価格はAIが書かない。planIdから通常コードが承認済み価格帯を注入する */
    plan: z.object({ planId: z.enum(PLAN_IDS), note: z.string().min(4).max(60) }).strict(),
    ctaMessage: z.string().min(4).max(60),
  })
  .strict();

export const sampleCopyArtifactSchema = z
  .object({
    kind: z.literal("sample_copy"),
    headline: z.string().min(4).max(40),
    body: z.string().min(10).max(1800),
    cta: z.string().min(4).max(120),
    hashtags: z.array(z.string().regex(/^#\S+$/).max(40)).min(5).max(15),
    slides: sampleSlidesSchema,
  })
  .strict();
export type SampleCopy = z.infer<typeof sampleCopyArtifactSchema>;

export const sampleScreenshotRefSchema = z
  .object({
    name: z.enum(SAMPLE_SCREENSHOT_NAMES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(100).max(12_000),
    height: z.number().int().min(100).max(40_000),
    safeRelativePath: z.string().min(1).max(300),
  })
  .strict();
export type SampleScreenshotRef = z.infer<typeof sampleScreenshotRefSchema>;

/** 承認済み価格帯(config/pricing.yaml)。通常コードがplanIdから注入する。AIは書かない */
export const priceBandSchema = z
  .object({
    planId: z.enum(PLAN_IDS),
    label: z.string().min(1).max(20),
    build: z.string().min(1).max(30),
    maintenance: z.string().min(1).max(30),
    disclaimer: z.string().min(1).max(120),
  })
  .strict();
export type PriceBand = z.infer<typeof priceBandSchema>;

export const sampleSpecSchema = z
  .object({
    ...specBase,
    templateId: z.literal("tpl-sample"),
    slides: sampleSlidesSchema,
    sampleId: z.string().min(1).max(40),
    sampleTitle: z.string().min(1).max(48),
    screenshots: z.object({ pcFold: sampleScreenshotRefSchema, spFold: sampleScreenshotRefSchema }).strict(),
    priceBand: priceBandSchema,
  })
  .strict();

export const carouselSpecSchema = z.discriminatedUnion("templateId", [
  howtoSpecSchema,
  newsSpecSchema,
  portfolioSpecSchema,
  compareSpecSchema,
  sampleSpecSchema,
]);
export type CarouselSpec = z.infer<typeof carouselSpecSchema>;
export type HowtoSpec = z.infer<typeof howtoSpecSchema>;
export type NewsSpec = z.infer<typeof newsSpecSchema>;
export type PortfolioSpec = z.infer<typeof portfolioSpecSchema>;
export type CompareSpec = z.infer<typeof compareSpecSchema>;
export type SampleSpec = z.infer<typeof sampleSpecSchema>;

export const TEMPLATE_IDS = ["tpl-howto", "tpl-news", "tpl-portfolio", "tpl-compare", "tpl-sample"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** config/pricing.yaml(owner専用)。ここにある文字列だけが投稿に出てよい価格表記 */
const pricingBandSchema = z.object({ label: z.string().min(1).max(20), build: z.string().min(1).max(30), maintenance: z.string().min(1).max(30) }).strict();
export const pricingSchema = z
  .object({
    approved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    approved_public_price_bands: z.object({ ume: pricingBandSchema, take: pricingBandSchema, matsu: pricingBandSchema }).strict(),
    disclaimer: z.string().min(1).max(120),
  })
  .strict();
export type Pricing = z.infer<typeof pricingSchema>;

/** レンダリング画像成果物のメタデータ(artifacts.content_json、kind="image") */
export const imageMetaSchema = z
  .object({
    specArtifactId: z.string().min(1),
    sourceCopyArtifactId: z.string().min(1),
    page: z.number().int().min(1),
    pageCount: z.number().int().min(3),
  })
  .strict();
export type ImageMeta = z.infer<typeof imageMetaSchema>;

/**
 * QAレポート v2(V3-A)。
 * - result: pass / fail / blocked_rights(権利確認待ち — 承認キューへ進めない)
 * - issues: 公開を止める重大指摘(passと両立しない — 構造的に拒否)
 * - notes: 代表者確認が必要な軽微な指摘(passと両立する)
 */
export const qaReportArtifactSchema = z
  .object({
    kind: z.literal("qa_report"),
    result: z.enum(["pass", "fail", "blocked_rights"]),
    checklist: z
      .array(
        z
          .object({
            item: z.string().min(1).max(80),
            ok: z.boolean(),
            note: z.string().max(200).optional(),
          })
          .strict(),
      )
      .min(3),
    issues: z.array(z.string().max(200)).default([]),
    notes: z.array(z.string().max(200)).default([]),
  })
  .strict();
export type QaReport = z.infer<typeof qaReportArtifactSchema>;

/** 公開許可の範囲(V3-C/レビュー指摘1)。項目別に個別判定する */
export const permissionScopeSchema = z
  .object({
    name: z.boolean(),
    url: z.boolean(),
    screenshot: z.boolean(),
    testimonial: z.boolean(),
  })
  .strict();
export type PermissionScope = z.infer<typeof permissionScopeSchema>;
export const SCOPE_NONE: PermissionScope = { name: false, url: false, screenshot: false, testimonial: false };

/** 情報源の登録入力(V3-B, docs/15)。DB登録はオーケストレーターがCLI経由で行う */
export const sourceInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    url: z
      .string()
      .url()
      .max(500)
      .refine((u) => u.startsWith("http://") || u.startsWith("https://"), "URLはhttp/httpsのみ許可されています"),
    publisher: z.string().min(1).max(100),
    /** 不明な場合は省略 → verificationStatusはunconfirmed扱い */
    publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    factOrInference: z.enum(["fact", "inference", "opinion"]),
    reliability: z.enum(["high", "medium", "low"]),
    isPrimary: z.boolean().default(false),
    /** 外部本文の大量保存はしない — 要約のみ */
    summary: z.string().max(500).default(""),
    /** ページが取得できなかった場合はfalse+unconfirmed */
    fetched: z.boolean().default(true),
  })
  .strict();
export type SourceInput = z.infer<typeof sourceInputSchema>;

/**
 * レポート(V3-G日報 + V4週報/月報)。DBの事実のみ集計・推定値は「推定」と明示。
 * periodStart/periodEnd は週報/月報の期間(daily成果物には無いためoptional=後方互換)。
 */
export const reportArtifactSchema = z
  .object({
    kind: z.literal("report"),
    reportKind: z.enum(["daily", "weekly", "monthly"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    stats: z.record(z.number()),
    lines: z.array(z.string().max(300)),
    ownerActions: z.array(z.string().max(300)),
    tomorrow: z.array(z.string().max(300)),
    /** 投稿10本未満などデータ不足の注記(統計的断定をしない旨) */
    dataNote: z.string().max(300).optional(),
  })
  .strict();
export type ReportArtifact = z.infer<typeof reportArtifactSchema>;

/**
 * 週次会議の議事録(V4-C)。事実・観察・提案・決定を分離する。
 * decisions は代表者が承認した決定のみ(オーケストレーターが記録)。
 */
export const meetingMinutesArtifactSchema = z
  .object({
    kind: z.literal("meeting_minutes"),
    meetingKind: z.enum(["weekly", "monthly"]),
    heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    participants: z.array(z.string().max(40)).max(12),
    agenda: z.array(z.string().max(200)).max(20),
    facts: z.array(z.string().max(300)).max(40), // 湊: DB集計の事実
    observations: z.array(z.string().max(300)).max(20),
    proposals: z.array(z.string().max(300)).max(20), // 蓮: 改善仮説
    decisions: z.array(z.string().max(300)).max(20), // 代表者承認済みのみ
    ownerActions: z.array(z.string().max(300)).max(20),
    nextWeekPlan: z.array(z.string().max(300)).max(20),
  })
  .strict();
export type MeetingMinutesArtifact = z.infer<typeof meetingMinutesArtifactSchema>;

/**
 * design QA(V4.5)。通常コードが全PNG+specから決定的に判定する(AI不使用)。
 * post_renders.design_qa_json に保存し、プレビュー/exportゲートの根拠にする。
 */
export const designQaCheckSchema = z.object({ id: z.string(), ok: z.boolean(), detail: z.string() }).strict();
export const designQaResultSchema = z
  .object({
    kind: z.literal("design_qa"),
    result: z.enum(["pass", "fail"]),
    templateId: z.string(),
    templateVersion: z.number().int(),
    variant: z.string(),
    fingerprint: z.string(),
    pageCount: z.number().int(),
    checks: z.array(designQaCheckSchema),
    failures: z.array(z.string()),
  })
  .strict();
export type DesignQaResult = z.infer<typeof designQaResultSchema>;

/**
 * 紫苑の視覚QA(V4.5)。レンダリング済み全PNGを実際に見て評価した構造化結果。
 * criticalIssuesが1件でもあれば承認キューへ進めない(fail closed)。
 */
export const visualQaArtifactSchema = z
  .object({
    kind: z.literal("visual_qa"),
    result: z.enum(["pass", "fail"]),
    criticalIssues: z.array(z.string().min(1).max(300)),
    minorIssues: z.array(z.string().min(1).max(300)),
    revisionInstructions: z.array(z.string().min(1).max(300)),
    pageFindings: z
      .array(z.object({ page: z.number().int().min(1), severity: z.enum(["critical", "minor"]), finding: z.string().min(1).max(300) }).strict())
      .max(50),
    /** V10: サンプルサイトの撮影画面QA(紬)でのみ使用。元デザイン画像との忠実度(lowはfailと両立しない) */
    fidelity: z.enum(["high", "medium", "low"]).optional(),
  })
  .strict()
  .refine((v) => (v.result === "pass" ? v.fidelity !== "low" : true), {
    message: "忠実度lowの状態ではresult=passにできません(元デザインの再現をやり直してください)",
  })
  .refine((v) => (v.result === "pass" ? v.criticalIssues.length === 0 : true), {
    message: "criticalIssuesがある場合はresult=passにできません(fail closed)",
  })
  // V4.5 v3: pass条件を厳格化。未解決のrevisionInstructions(代表者判断が必要な設計課題)が残っていればpass不可
  .refine((v) => (v.result === "pass" ? v.revisionInstructions.length === 0 : true), {
    message: "revisionInstructions(未解決の設計課題)が残っている場合はresult=passにできません",
  });
export type VisualQaArtifact = z.infer<typeof visualQaArtifactSchema>;

export const artifactContentSchema = z.union([
  noteArtifactSchema,
  postPlanArtifactSchema,
  copyArtifactSchema,
  newsCopyArtifactSchema,
  portfolioCopyArtifactSchema,
  compareCopyArtifactSchema,
  sampleCopyArtifactSchema,
  siteSampleArtifactSchema,
  carouselSpecSchema,
  qaReportArtifactSchema,
  reportArtifactSchema,
  meetingMinutesArtifactSchema,
  visualQaArtifactSchema,
]);
export type ArtifactContent = z.infer<typeof artifactContentSchema>;
export const ARTIFACT_KINDS = [
  "note",
  "post_plan",
  "copy",
  "news_copy",
  "portfolio_copy",
  "compare_copy",
  "sample_copy",
  "site_sample",
  "carousel_spec",
  "qa_report",
  "report",
  "meeting_minutes",
  "visual_qa",
  "image",
] as const;

/** post_metrics 入力(V4-C)。NULL可・負数拒否・整数。0や推定で穴埋めしない */
const metricInt = z.number().int().min(0).nullable();
export const postMetricInputSchema = z
  .object({
    postId: z.string().min(1),
    windowDays: z.union([z.literal(3), z.literal(7)]),
    reach: metricInt.optional(),
    profileViews: metricInt.optional(),
    saves: metricInt.optional(),
    shares: metricInt.optional(),
    comments: metricInt.optional(),
    dmStarts: metricInt.optional(),
    followerCount: metricInt.optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
export type PostMetricInput = z.infer<typeof postMetricInputSchema>;

/** 運用設定(V4-D)。settingsテーブルへ保存 */
export const operationSettingsSchema = z
  .object({
    weeklyPostTarget: z.number().int().min(1).max(7),
    ownerDailyMinutes: z.number().int().min(10).max(120),
    timezone: z.literal("Asia/Tokyo"),
  })
  .strict();
export type OperationSettings = z.infer<typeof operationSettingsSchema>;
export const DEFAULT_OPERATION_SETTINGS: OperationSettings = {
  weeklyPostTarget: 3,
  ownerDailyMinutes: 30,
  timezone: "Asia/Tokyo",
};

// ---- V6: 改善提案・CEO判断・事業成果 ----

/** V6再レビューP2-1: 一度に変えられる主要変数はこの6種から必ず1つだけ(自由文字列を許さない) */
export const TEST_VARIABLES = ["pillar", "format", "cta", "template", "variant", "posting_time"] as const;
export type TestVariable = (typeof TEST_VARIABLES)[number];

const GROUP_AXES = ["pillar", "format", "template", "templateVersion", "variant", "cta"] as const;
const FACT_METRICS = [
  "reach",
  "profileViews",
  "saves",
  "shares",
  "comments",
  "dmStarts",
  "followerCount",
  "saveRate",
  "shareRate",
  "profileViewRate",
  "dmStartRate",
  "commentRate",
] as const;

/**
 * V6再レビューP1-2: snapshot内の事実への構造化参照。
 * AIの自由文の数値は信用せず、通常コードが「参照先の実在」と「valueの完全一致」を検査する。
 * observation本文もこの参照から通常コードが生成する。
 */
export const structuredFactRefSchema = z.union([
  z
    .object({
      scope: z.literal("post"),
      postId: z.string().min(1).max(40),
      metric: z.enum(FACT_METRICS),
      value: z.number().nullable(),
    })
    .strict(),
  z
    .object({
      scope: z.literal("group"),
      axis: z.enum(GROUP_AXES),
      groupKey: z.string().min(1).max(120),
      stat: z.enum(["median", "mean", "total"]),
      metric: z.enum(FACT_METRICS),
      value: z.number().nullable(),
    })
    .strict(),
  z
    .object({
      scope: z.literal("group"),
      axis: z.enum(GROUP_AXES),
      groupKey: z.string().min(1).max(120),
      stat: z.literal("sampleCount"),
      value: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      scope: z.literal("coverage"),
      field: z.enum(["publishedCount", "measuredCount", "overdueCount", "notDueCount"]),
      value: z.number().int().min(0),
    })
    .strict(),
]);
export type StructuredFactRefInput = z.infer<typeof structuredFactRefSchema>;

/**
 * 改善提案(V6-C)。AI社員(蓮・湊など)が analysis snapshot の事実に紐づけて作る「提案」。
 * 決定ではない。承認・却下は improvementDecisionInputSchema(owner専用)で別に記録する。
 * observation(事実文)は入力に含めない — structuredFactRefsから通常コードが生成する(P1-2)。
 */
export const improvementProposalInputSchema = z
  .object({
    kind: z.literal("improvement_proposal"),
    analysisSnapshotId: z.string().min(1).max(40),
    /** 提案者のAI社員ID(emp_ren等)。ownerは提案者になれない(判断者だから) */
    authorEmployeeId: z.string().min(1).max(40),
    title: z.string().min(4).max(120),
    /** 根拠となるsnapshot内の事実(実在+値の完全一致を通常コードが検査する) */
    structuredFactRefs: z.array(structuredFactRefSchema).min(1).max(8),
    /** 仮説(断定しない。「傾向の可能性」「追加検証が必要」の表現。数値はここに書かない) */
    hypothesis: z.string().min(10).max(500),
    /** 根拠: snapshotのevidencePostIdsに含まれる投稿ID(実在検査される) */
    evidenceRefs: z.array(z.string().min(1).max(40)).min(1).max(20),
    /** 一度に変える主要変数(6種から1つだけ) */
    testVariable: z.enum(TEST_VARIABLES),
    /** 変更内容の構造化(from/to/対象条件)。複数変数の同時変更はtestVariable enumで構造的に不可 */
    testChange: z
      .object({
        from: z.string().min(1).max(120).optional(),
        to: z.string().min(1).max(120),
        condition: z.string().max(200).optional(),
      })
      .strict(),
    /** 期待する観測シグナル(例: 保存率の中央値が上がる)。保証ではない */
    expectedSignal: z.string().min(4).max(200),
    proposedAction: z.string().min(10).max(500),
    risk: z.string().min(4).max(300),
    /** 有効期限(JST業務日)。期限切れはkickoffで利用されない */
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type ImprovementProposalInput = z.infer<typeof improvementProposalInputSchema>;

export const IMPROVEMENT_DECISIONS = ["approved", "rejected", "revision_requested", "superseded"] as const;
export type ImprovementDecision = (typeof IMPROVEMENT_DECISIONS)[number];

/** CEO判断(append-only)。却下・修正依頼・棚上げは理由必須 */
export const improvementDecisionInputSchema = z
  .object({
    proposalId: z.string().min(1).max(40),
    decision: z.enum(IMPROVEMENT_DECISIONS),
    reason: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.decision === "approved" || (v.reason !== undefined && v.reason.trim().length > 0), {
    message: "却下・修正依頼・supersededには理由(reason)が必要です",
  });
export type ImprovementDecisionInput = z.infer<typeof improvementDecisionInputSchema>;

export const BUSINESS_OUTCOME_KINDS = ["inquiry", "estimate", "order"] as const;
export const BUSINESS_OUTCOME_SOURCES = ["instagram", "referral", "website", "unknown"] as const;

/**
 * 事業成果の手動記録(V6-G)。owner専用・匿名。
 * 顧客名・電話・メール・LINE ID・DM原文など個人を特定できる情報は保存しない(通常コードで拒否)。
 */
export const businessOutcomeInputSchema = z
  .object({
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(BUSINESS_OUTCOME_KINDS),
    source: z.enum(BUSINESS_OUTCOME_SOURCES),
    relatedPostId: z.string().min(1).max(40).nullable().optional(),
    amountYen: z.number().int().min(0).max(100_000_000).nullable().optional(),
    anonymizedNote: z.string().max(200).nullable().optional(),
  })
  .strict();
export type BusinessOutcomeInput = z.infer<typeof businessOutcomeInputSchema>;

export const modelProfileSchema = z.enum(MODEL_PROFILES);

/**
 * limits.yaml の構造(docs/14)。
 * daily配下は互いに独立ではない(例: max_tasksが小さいとmax_agent_launchesに達する前に
 * 「日次タスク上限」で先に停止し、意図と異なるエラーになる)。superRefineで相互整合性を検査する
 * (改善#4: max_tasks(32) < max_agent_launches(40)によりテストが誤った上限で失敗した実例の再発防止)。
 */
export const limitsSchema = z
  .object({
    daily: z.object({
      max_generated_posts: z.number().int().positive(),
      max_tasks: z.number().int().positive(),
      max_heavy_escalations: z.number().int().positive(),
      max_research_fetches: z.number().int().positive(),
      max_est_output_chars: z.number().int().positive(),
      max_agent_launches: z.number().int().positive(),
      /** V10: 1日のサンプルサイト制作上限(ビルド=撮影を伴う重い工程。既定1) */
      max_site_samples: z.number().int().positive().default(1),
    }),
    retry: z.object({
      per_task: z.number().int().min(0).max(5),
      replan_days: z.number().int().min(0),
    }),
    approval_queue: z.object({ soft_cap: z.number().int().positive() }),
    stale: z.object({ heartbeat_minutes: z.number().int().positive() }),
    api: z.object({ monthly_budget_yen: z.number().int().min(0) }),
  })
  .superRefine((limits, ctx) => {
    const { max_tasks, max_agent_launches, max_generated_posts } = limits.daily;
    if (max_tasks <= max_agent_launches) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily", "max_tasks"],
        message: `max_tasks(${max_tasks})はmax_agent_launches(${max_agent_launches})より大きくなければなりません。タスク起動より先に「日次タスク上限」で停止してしまいます`,
      });
    }
    if (max_generated_posts > max_tasks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["daily", "max_generated_posts"],
        message: `max_generated_posts(${max_generated_posts})はmax_tasks(${max_tasks})以下でなければなりません(投稿1本につき企画・コピー等で複数タスクが必要)`,
      });
    }
    if (limits.approval_queue.soft_cap > max_generated_posts * 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approval_queue", "soft_cap"],
        message: `approval_queue.soft_cap(${limits.approval_queue.soft_cap})が極端に大きく、max_generated_posts(${max_generated_posts})との整合が取れていない可能性があります`,
      });
    }
  });
export type Limits = z.infer<typeof limitsSchema>;
