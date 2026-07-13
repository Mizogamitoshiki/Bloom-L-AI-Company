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

/**
 * カルーセル仕様(レンダラー入力。通常コードがslides+planから構築する)。
 * sourceCopyArtifactId: 入力になったcopy成果物の不変ID。
 * QA合格ゲートは「最新copy = spec.sourceCopyArtifactId」の一致で検証する(version番号の偶然一致に依存しない)。
 */
export const carouselSpecSchema = z
  .object({
    kind: z.literal("carousel_spec"),
    templateId: z.literal("tpl-howto"),
    pillar: z.enum(["1", "2", "3", "4", "5", "6"]),
    sourceCopyArtifactId: z.string().min(1),
    slides: slidesSchema,
  })
  .strict();
export type CarouselSpec = z.infer<typeof carouselSpecSchema>;

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

/** QAレポート(docs/05 紫苑の出力) */
export const qaReportArtifactSchema = z
  .object({
    kind: z.literal("qa_report"),
    result: z.enum(["pass", "fail"]),
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
  })
  .strict();
export type QaReport = z.infer<typeof qaReportArtifactSchema>;

export const artifactContentSchema = z.discriminatedUnion("kind", [
  noteArtifactSchema,
  postPlanArtifactSchema,
  copyArtifactSchema,
  carouselSpecSchema,
  qaReportArtifactSchema,
]);
export type ArtifactContent = z.infer<typeof artifactContentSchema>;
export const ARTIFACT_KINDS = ["note", "post_plan", "copy", "carousel_spec", "qa_report", "image"] as const;

export const modelProfileSchema = z.enum(MODEL_PROFILES);

/** limits.yaml の構造(docs/14) */
export const limitsSchema = z.object({
  daily: z.object({
    max_generated_posts: z.number().int().positive(),
    max_tasks: z.number().int().positive(),
    max_heavy_escalations: z.number().int().positive(),
    max_research_fetches: z.number().int().positive(),
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
