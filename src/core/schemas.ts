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
} as const;

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

/** displayNameは許可状態から通常コードが決定する(AIが顧客名を書かない) */
export const portfolioSpecSchema = z
  .object({
    ...specBase,
    templateId: z.literal("tpl-portfolio"),
    slides: portfolioSlidesSchema,
    displayName: z.string().min(1).max(30),
    anonymous: z.boolean(),
  })
  .strict();

export const carouselSpecSchema = z.discriminatedUnion("templateId", [
  howtoSpecSchema,
  newsSpecSchema,
  portfolioSpecSchema,
]);
export type CarouselSpec = z.infer<typeof carouselSpecSchema>;
export type HowtoSpec = z.infer<typeof howtoSpecSchema>;
export type NewsSpec = z.infer<typeof newsSpecSchema>;
export type PortfolioSpec = z.infer<typeof portfolioSpecSchema>;

export const TEMPLATE_IDS = ["tpl-howto", "tpl-news", "tpl-portfolio"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

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

/** 日報(V3-G)。DBの事実のみ集計。推定値は「推定」と明示 */
export const reportArtifactSchema = z
  .object({
    kind: z.literal("report"),
    reportKind: z.enum(["daily"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    stats: z.record(z.number()),
    lines: z.array(z.string().max(300)),
    ownerActions: z.array(z.string().max(300)),
    tomorrow: z.array(z.string().max(300)),
  })
  .strict();
export type ReportArtifact = z.infer<typeof reportArtifactSchema>;

export const artifactContentSchema = z.union([
  noteArtifactSchema,
  postPlanArtifactSchema,
  copyArtifactSchema,
  newsCopyArtifactSchema,
  portfolioCopyArtifactSchema,
  carouselSpecSchema,
  qaReportArtifactSchema,
  reportArtifactSchema,
]);
export type ArtifactContent = z.infer<typeof artifactContentSchema>;
export const ARTIFACT_KINDS = [
  "note",
  "post_plan",
  "copy",
  "news_copy",
  "portfolio_copy",
  "carousel_spec",
  "qa_report",
  "report",
  "image",
] as const;

export const modelProfileSchema = z.enum(MODEL_PROFILES);

/** limits.yaml の構造(docs/14) */
export const limitsSchema = z.object({
  daily: z.object({
    max_generated_posts: z.number().int().positive(),
    max_tasks: z.number().int().positive(),
    max_heavy_escalations: z.number().int().positive(),
    max_research_fetches: z.number().int().positive(),
    max_est_output_chars: z.number().int().positive(),
    max_agent_launches: z.number().int().positive(),
  }),
  retry: z.object({
    per_task: z.number().int().min(0).max(5),
    replan_days: z.number().int().min(0),
  }),
  approval_queue: z.object({ soft_cap: z.number().int().positive() }),
  stale: z.object({ heartbeat_minutes: z.number().int().positive() }),
  api: z.object({ monthly_budget_yen: z.number().int().min(0) }),
});
export type Limits = z.infer<typeof limitsSchema>;
