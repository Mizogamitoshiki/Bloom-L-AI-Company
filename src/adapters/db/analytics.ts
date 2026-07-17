/**
 * V6-B: 分析スナップショットのDBアダプター。
 * - 入力(公開済み投稿+post_metrics+レンダリング記録+CTA)をDBから決定的に収集する
 * - 集計はsrc/core/analytics.tsの純関数のみ(AI不使用・再計算なし)
 * - analysis_snapshotsはappend-only。(window_days, source_data_hash)一意で冪等
 * - 既存post_metricsを正本として読むだけ(複製テーブルは作らない)。実DBの既存データを変更しない
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./client";
import * as t from "./schema";
import { audit } from "./store";
import { addDays, businessDate, businessDateFromIso, nowIso, ulid } from "../../core/ids";
import {
  ANALYSIS_WINDOWS,
  buildAnalysisFacts,
  canonicalJson,
  type AnalysisFacts,
  type AnalysisWindow,
  type AnalyticsPostInput,
} from "../../core/analytics";

const COPY_KINDS = ["copy", "news_copy", "portfolio_copy", "compare_copy"] as const;

/** 公開済み投稿の分析入力をDBから収集する(読み取りのみ・決定的) */
export function gatherAnalyticsInput(db: Db, windowDays: AnalysisWindow): AnalyticsPostInput[] {
  const posts = db
    .select()
    .from(t.posts)
    .where(inArray(t.posts.status, ["published", "measured"]))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id));

  return posts.map((post) => {
    const metric = db
      .select()
      .from(t.postMetrics)
      .where(and(eq(t.postMetrics.postId, post.id), eq(t.postMetrics.windowDays, windowDays)))
      .get();
    const render = db
      .select()
      .from(t.postRenders)
      .where(eq(t.postRenders.postId, post.id))
      .orderBy(desc(t.postRenders.createdAt))
      .get();
    const copyArtifact = db
      .select({ contentJson: t.artifacts.contentJson, version: t.artifacts.version, createdAt: t.artifacts.createdAt })
      .from(t.artifacts)
      .where(and(eq(t.artifacts.postId, post.id), inArray(t.artifacts.kind, [...COPY_KINDS])))
      .orderBy(desc(t.artifacts.version), desc(t.artifacts.createdAt))
      .get();
    let cta: string | null = null;
    if (copyArtifact?.contentJson) {
      try {
        const parsed = JSON.parse(copyArtifact.contentJson) as { cta?: unknown };
        cta = typeof parsed.cta === "string" && parsed.cta.length > 0 ? parsed.cta : null;
      } catch {
        cta = null; // 壊れたJSONは分類キーなし扱い(捏造しない)
      }
    }
    const publishedBd = post.publishedAt ? businessDateFromIso(post.publishedAt) : null;
    return {
      postId: post.id,
      title: post.title,
      pillar: post.pillar,
      format: post.format,
      templateId: post.templateId,
      templateVersion: render?.templateVersion ?? null,
      variant: render?.variant ?? null,
      cta,
      publishedAt: post.publishedAt,
      metricDueOn: publishedBd ? addDays(publishedBd, windowDays) : null,
      metrics: metric
        ? {
            reach: metric.reach,
            profileViews: metric.profileViews,
            saves: metric.saves,
            shares: metric.shares,
            comments: metric.comments,
            dmStarts: metric.dmStarts,
            followerCount: metric.followerCount,
            measuredAt: metric.measuredAt,
          }
        : null,
    };
  });
}

/**
 * 冪等性材料のhash(P1-1)。入力データに加えて**JST業務日(asOfBusinessDate)**を含める。
 * overdue/notDue等の期限判定はtodayに依存するため、入力値が同じでも業務日が変われば
 * 新しいsnapshotを生成する(同一業務日・同一入力なら冪等)。
 * createAnalysisSnapshotとcronのdry-runは必ずこの同一関数を使うこと。
 */
export function computeSourceDataHash(input: AnalyticsPostInput[], asOfBusinessDate: string): string {
  return createHash("sha256").update(canonicalJson({ asOfBusinessDate, input })).digest("hex");
}

export interface SnapshotResult {
  created: boolean;
  snapshotId: string;
  windowDays: AnalysisWindow;
  sourceDataHash: string;
  facts: AnalysisFacts;
}

/**
 * 分析スナップショットの生成(冪等)。
 * 同じ入力(sourceDataHash一致)なら既存スナップショットを返し、新規行を作らない。
 * 元データが変わったときだけ新しいスナップショットを追記する(append-only)。
 */
export function createAnalysisSnapshot(
  db: Db,
  windowDays: AnalysisWindow,
  actor: string,
  options: { today?: string } = {},
): SnapshotResult {
  const today = options.today ?? businessDate();
  const input = gatherAnalyticsInput(db, windowDays);
  const sourceDataHash = computeSourceDataHash(input, today);
  const facts = buildAnalysisFacts(input, windowDays, { today });

  const existing = db
    .select()
    .from(t.analysisSnapshots)
    .where(and(eq(t.analysisSnapshots.windowDays, windowDays), eq(t.analysisSnapshots.sourceDataHash, sourceDataHash)))
    .get();
  if (existing) {
    return {
      created: false,
      snapshotId: existing.id,
      windowDays,
      sourceDataHash,
      facts: JSON.parse(existing.snapshotJson) as AnalysisFacts,
    };
  }

  const id = ulid();
  const now = nowIso();
  db.transaction((tx) => {
    tx.insert(t.analysisSnapshots)
      .values({
        id,
        windowDays,
        periodStart: facts.periodStart,
        periodEnd: facts.periodEnd,
        generatedAt: now,
        sourceDataHash,
        snapshotJson: JSON.stringify(facts),
        createdAt: now,
      })
      .run();
    audit(tx, actor, "analysis_snapshot_created", "analysis_snapshot", id, {
      windowDays,
      sourceDataHash,
      publishedCount: facts.dataCoverage.publishedCount,
      measuredCount: facts.dataCoverage.measuredCount,
    });
  });
  return { created: true, snapshotId: id, windowDays, sourceDataHash, facts };
}

export interface SnapshotRow {
  id: string;
  windowDays: number;
  periodStart: string | null;
  periodEnd: string | null;
  generatedAt: string;
  sourceDataHash: string;
  facts: AnalysisFacts;
}

export function getAnalysisSnapshot(db: Db, snapshotId: string): SnapshotRow | null {
  const row = db.select().from(t.analysisSnapshots).where(eq(t.analysisSnapshots.id, snapshotId)).get();
  if (!row) return null;
  return { ...row, facts: JSON.parse(row.snapshotJson) as AnalysisFacts };
}

export function latestAnalysisSnapshot(db: Db, windowDays: AnalysisWindow): SnapshotRow | null {
  const row = db
    .select()
    .from(t.analysisSnapshots)
    .where(eq(t.analysisSnapshots.windowDays, windowDays))
    .orderBy(desc(t.analysisSnapshots.createdAt))
    .get();
  if (!row) return null;
  return { ...row, facts: JSON.parse(row.snapshotJson) as AnalysisFacts };
}

export function listAnalysisSnapshots(db: Db): Omit<SnapshotRow, "facts">[] {
  return db
    .select({
      id: t.analysisSnapshots.id,
      windowDays: t.analysisSnapshots.windowDays,
      periodStart: t.analysisSnapshots.periodStart,
      periodEnd: t.analysisSnapshots.periodEnd,
      generatedAt: t.analysisSnapshots.generatedAt,
      sourceDataHash: t.analysisSnapshots.sourceDataHash,
    })
    .from(t.analysisSnapshots)
    .orderBy(desc(t.analysisSnapshots.createdAt))
    .all();
}

/** 全窓のスナップショットを冪等生成する(kickoff/cronの共通ユースケース) */
export function createAllWindowSnapshots(db: Db, actor: string, options: { today?: string } = {}): SnapshotResult[] {
  return ANALYSIS_WINDOWS.map((w) => createAnalysisSnapshot(db, w, actor, options));
}
