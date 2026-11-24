/**
 * V10 サイトサンプル(docs/32)のDB操作。書き込みは company CLI / Next.js UI(owner)経由のみ。
 * - sample_requests: 代表者のintake(素材の権利宣言 attest が必須。owner専用)
 * - sample_assets: 投入素材(kind=design/hero/logo/photo/reference)。パス・hash・寸法だけを記録
 * - site_samples: ビルド済みサンプル(撮影PNGのhashを刻印)。紬の視覚QA(fidelity)を持つ
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import * as t from "./schema";
import { audit, type DbConn } from "./store";
import { ulid, nowIso, businessDate } from "../../core/ids";
import {
  sampleRequestInputSchema,
  sampleAssetInputSchema,
  visualQaArtifactSchema,
  sampleScreenshotRefSchema,
  SAMPLE_REQUEST_STATUSES,
  type SampleRequestInput,
  type SampleAssetInput,
  type SampleRequestStatus,
  type SampleScreenshotRef,
  type VisualQaArtifact,
} from "../../core/schemas";
import { inspectSampleAsset } from "../render/sample-media";
import { loadLimits } from "../config";
import { z } from "zod";

export type SampleRequestRow = typeof t.sampleRequests.$inferSelect;
export type SampleAssetRow = typeof t.sampleAssets.$inferSelect;
export type SiteSampleRow = typeof t.siteSamples.$inferSelect;

export interface SampleRequestView {
  request: SampleRequestRow;
  assets: SampleAssetRow[];
  latestSample: SiteSampleRow | null;
}

function assertOwner(actor: string, what: string): void {
  if (actor !== "owner") throw new Error(`${what}は代表者(owner)のみが行えます`);
}

function requestOrThrow(conn: DbConn, requestId: string): SampleRequestRow {
  const row = conn.select().from(t.sampleRequests).where(eq(t.sampleRequests.id, requestId)).get();
  if (!row) throw new Error(`サンプル依頼が見つかりません: ${requestId}`);
  return row;
}

/** 代表者のintake。attest=true(自分が権利を持つデザイン・素材のみ)を構造的に要求し、監査ログへ残す */
export function createSampleRequest(db: Db, input: unknown, actor: string): SampleRequestRow {
  assertOwner(actor, "サンプル依頼の登録");
  const parsed: SampleRequestInput = sampleRequestInputSchema.parse(input);
  return db.transaction((tx) => {
    const dup = tx.select({ id: t.sampleRequests.id }).from(t.sampleRequests).where(eq(t.sampleRequests.slug, parsed.slug)).get();
    if (dup) throw new Error(`slug「${parsed.slug}」は既に使われています(${dup.id})`);
    const id = ulid();
    const now = nowIso();
    tx.insert(t.sampleRequests)
      .values({
        id,
        slug: parsed.slug,
        siteTitle: parsed.siteTitle?.trim() || null,
        industry: parsed.industry.trim(),
        persona: parsed.persona,
        planTarget: parsed.planTarget,
        pagesJson: JSON.stringify(parsed.pages),
        brief: parsed.brief.trim(),
        status: "new",
        attestedAt: now,
        attestedBy: actor,
        declineReason: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    audit(tx, actor, "sample_request_create", "sample_request", id, { slug: parsed.slug, industry: parsed.industry, persona: parsed.persona });
    audit(tx, actor, "sample_attest", "sample_request", id, {
      statement: "投入する画像は自分(Bloom-L)が権利を持つ、または商用利用可能なライセンスで取得したもので、実在の第三者の写真・ロゴ・著作物・他社サイトの画面を含まない",
    });
    return tx.select().from(t.sampleRequests).where(eq(t.sampleRequests.id, id)).get()!;
  });
}

/**
 * 投入素材の登録(owner専用)。ファイルは既に input/ に置かれている前提で、実デコード検査→hash・寸法を記録する。
 * 同名ファイルの再登録は上書き(hash更新)ではなく拒否する(差し替えは別名で)。
 */
export async function addSampleAsset(db: Db, requestId: string, input: unknown, actor: string): Promise<SampleAssetRow> {
  assertOwner(actor, "サンプル素材の登録");
  const parsed: SampleAssetInput = sampleAssetInputSchema.parse(input);
  const request = requestOrThrow(db, requestId);
  if (request.status === "declined") throw new Error("見送り済みの依頼には素材を追加できません");
  const img = await inspectSampleAsset(requestId, parsed.fileName);
  return db.transaction((tx) => {
    const dup = tx
      .select({ id: t.sampleAssets.id })
      .from(t.sampleAssets)
      .where(and(eq(t.sampleAssets.requestId, requestId), eq(t.sampleAssets.fileName, parsed.fileName)))
      .get();
    if (dup) throw new Error(`素材「${parsed.fileName}」は登録済みです(差し替える場合は別名で追加してください)`);
    const id = ulid();
    tx.insert(t.sampleAssets)
      .values({
        id,
        requestId,
        kind: parsed.kind,
        fileName: parsed.fileName,
        safeRelativePath: img.safeRelativePath,
        sha256: img.sha256,
        width: img.width,
        height: img.height,
        bytes: img.bytes,
        createdAt: nowIso(),
      })
      .run();
    tx.update(t.sampleRequests).set({ updatedAt: nowIso() }).where(eq(t.sampleRequests.id, requestId)).run();
    audit(tx, actor, "sample_asset_add", "sample_request", requestId, { fileName: parsed.fileName, kind: parsed.kind, sha256: img.sha256 });
    return tx.select().from(t.sampleAssets).where(eq(t.sampleAssets.id, id)).get()!;
  });
}

export function listSampleAssets(conn: DbConn, requestId: string): SampleAssetRow[] {
  return conn.select().from(t.sampleAssets).where(eq(t.sampleAssets.requestId, requestId)).orderBy(t.sampleAssets.createdAt).all();
}

export function latestSiteSampleForRequest(conn: DbConn, requestId: string): SiteSampleRow | null {
  return (
    conn.select().from(t.siteSamples).where(eq(t.siteSamples.requestId, requestId)).orderBy(desc(t.siteSamples.version)).get() ?? null
  );
}

export function listSampleRequests(db: Db, status?: string): SampleRequestView[] {
  if (status && !(SAMPLE_REQUEST_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`不明なstatus: ${status}(${SAMPLE_REQUEST_STATUSES.join("|")})`);
  }
  const rows = status
    ? db.select().from(t.sampleRequests).where(eq(t.sampleRequests.status, status)).orderBy(desc(t.sampleRequests.createdAt)).all()
    : db.select().from(t.sampleRequests).orderBy(desc(t.sampleRequests.createdAt)).all();
  return rows.map((request) => ({ request, assets: listSampleAssets(db, request.id), latestSample: latestSiteSampleForRequest(db, request.id) }));
}

export function getSampleRequest(db: Db, requestId: string): SampleRequestView {
  const request = requestOrThrow(db, requestId);
  return { request, assets: listSampleAssets(db, request.id), latestSample: latestSiteSampleForRequest(db, request.id) };
}

/**
 * AIプロンプトへ渡す前提のビュー。権利宣言済み(=登録済み)素材だけを、種別付きで返す。
 * reference(参考画像)は「画面に使えない」ことを明示して渡す(颯が誤って使えば通常コードが拒否する)。
 */
export interface SampleRequestAiView {
  id: string;
  slug: string;
  siteTitle: string | null;
  industry: string;
  persona: string;
  planTarget: string;
  pages: string[];
  brief: string;
  status: string;
  assets: { fileName: string; kind: string; width: number; height: number; path: string; usableInScreen: boolean }[];
  latestSample: { id: string; version: number; designQaResult: string | null } | null;
}

export function listSampleRequestsForAi(db: Db, status?: string): SampleRequestAiView[] {
  return listSampleRequests(db, status).map(({ request, assets, latestSample }) => ({
    id: request.id,
    slug: request.slug,
    siteTitle: request.siteTitle,
    industry: request.industry,
    persona: request.persona,
    planTarget: request.planTarget,
    pages: JSON.parse(request.pagesJson) as string[],
    brief: request.brief,
    status: request.status,
    assets: assets.map((a) => ({
      fileName: a.fileName,
      kind: a.kind,
      width: a.width,
      height: a.height,
      path: `data/workspace/${a.safeRelativePath}`,
      usableInScreen: a.kind !== "reference",
    })),
    latestSample: latestSample ? { id: latestSample.id, version: latestSample.version, designQaResult: latestSample.designQaResult } : null,
  }));
}

export function setSampleRequestStatus(conn: DbConn, requestId: string, status: SampleRequestStatus, actor: string, extra: Record<string, unknown> = {}): void {
  const request = requestOrThrow(conn, requestId);
  conn.update(t.sampleRequests).set({ status, updatedAt: nowIso() }).where(eq(t.sampleRequests.id, requestId)).run();
  audit(conn, actor, "sample_request_status", "sample_request", requestId, { from: request.status, to: status, ...extra });
}

/** 見送り(owner専用・理由必須)。素材ファイルは削除しない(監査のため) */
export function declineSampleRequest(db: Db, requestId: string, reason: string, actor: string): void {
  assertOwner(actor, "サンプル依頼の見送り");
  if (!reason.trim()) throw new Error("見送りには理由が必要です");
  db.transaction((tx) => {
    const request = requestOrThrow(tx, requestId);
    if (request.status === "posted") throw new Error("投稿済みの依頼は見送りにできません");
    tx.update(t.sampleRequests)
      .set({ status: "declined", declineReason: reason.trim(), updatedAt: nowIso() })
      .where(eq(t.sampleRequests.id, requestId))
      .run();
    audit(tx, actor, "sample_request_status", "sample_request", requestId, { from: request.status, to: "declined", reason: reason.trim() });
  });
}

/** 本日ビルド済みのサンプル数(JST業務日)。limits.daily.max_site_samples の判定と同一クエリ */
export function siteSamplesBuiltToday(conn: DbConn, today: string = businessDate()): number {
  return (
    conn
      .select({ n: sql<number>`count(*)` })
      .from(t.siteSamples)
      .where(sql`date(${t.siteSamples.createdAt}, '+9 hours') = ${today}`)
      .get()?.n ?? 0
  );
}

export function assertSiteSampleLimit(conn: DbConn): void {
  const limits = loadLimits();
  const n = siteSamplesBuiltToday(conn);
  if (n >= limits.daily.max_site_samples) {
    throw new Error(`本日のサンプルサイト制作上限(${limits.daily.max_site_samples}本)に達しています(docs/32 §4。config/limits.yaml max_site_samples)`);
  }
}

export interface RecordSiteSampleInput {
  requestId: string;
  siteTitle: string;
  concept: string;
  planFit: string;
  planFitReason: string;
  dirPath: string;
  htmlSha256: string;
  screenshots: SampleScreenshotRef[];
  artifactId: string;
  builderTaskId: string;
}

/** ビルド完了の記録(通常コードのsample-buildから)。version=依頼内の連番。依頼はqa状態へ */
export function recordSiteSample(db: Db, input: RecordSiteSampleInput, actor: string): SiteSampleRow {
  const screenshots = z.array(sampleScreenshotRefSchema).min(4).max(4).parse(input.screenshots);
  return db.transaction((tx) => {
    requestOrThrow(tx, input.requestId);
    const latest = latestSiteSampleForRequest(tx, input.requestId);
    const version = (latest?.version ?? 0) + 1;
    const id = ulid();
    tx.insert(t.siteSamples)
      .values({
        id,
        requestId: input.requestId,
        version,
        siteTitle: input.siteTitle,
        concept: input.concept,
        planFit: input.planFit,
        planFitReason: input.planFitReason,
        dirPath: input.dirPath,
        htmlSha256: input.htmlSha256,
        screenshotsJson: JSON.stringify(screenshots),
        artifactId: input.artifactId,
        builderTaskId: input.builderTaskId,
        designQaResult: null,
        designQaJson: null,
        deployUrl: null,
        deployedAt: null,
        createdAt: nowIso(),
      })
      .run();
    setSampleRequestStatus(tx, input.requestId, "qa", actor, { sampleId: id, version });
    audit(tx, actor, "site_sample_built", "site_sample", id, { requestId: input.requestId, version, htmlSha256: input.htmlSha256 });
    return tx.select().from(t.siteSamples).where(eq(t.siteSamples.id, id)).get()!;
  });
}

export function getSiteSample(conn: DbConn, sampleId: string): SiteSampleRow {
  const row = conn.select().from(t.siteSamples).where(eq(t.siteSamples.id, sampleId)).get();
  if (!row) throw new Error(`サンプルサイトが見つかりません: ${sampleId}`);
  return row;
}

export function siteSampleScreenshots(row: SiteSampleRow): SampleScreenshotRef[] {
  return z.array(sampleScreenshotRefSchema).parse(JSON.parse(row.screenshotsJson));
}

/**
 * 紬の視覚QA(忠実度)を記録する。actor=tsumugi のみ。fail closed(fidelity=low/criticalありはpass不可=スキーマが拒否)。
 * pass → 依頼は ready(投稿可能)。fail → 依頼は building(颯の作り直し)。
 */
export function recordSampleDesignQa(db: Db, sampleId: string, visualQa: unknown, actor: string): VisualQaArtifact {
  if (actor !== "tsumugi") throw new Error("サンプル画面の視覚QAを記録できるのは紬(actor=tsumugi)のみです");
  const parsed = visualQaArtifactSchema.parse(visualQa);
  if (!parsed.fidelity) throw new Error("サンプル画面の視覚QAには fidelity(high|medium|low) が必要です");
  db.transaction((tx) => {
    const sample = getSiteSample(tx, sampleId);
    tx.update(t.siteSamples)
      .set({ designQaResult: parsed.result, designQaJson: JSON.stringify(parsed) })
      .where(eq(t.siteSamples.id, sampleId))
      .run();
    setSampleRequestStatus(tx, sample.requestId, parsed.result === "pass" ? "ready" : "building", actor, { sampleId, fidelity: parsed.fidelity });
    audit(tx, actor, "site_sample_design_qa", "site_sample", sampleId, { result: parsed.result, fidelity: parsed.fidelity, critical: parsed.criticalIssues.length });
  });
  return parsed;
}

/** 投稿が承認キューへ入った/公開された時などに依頼の状態を進める(通常コードから) */
export function markSampleRequestPosted(conn: DbConn, sampleId: string, postId: string, actor: string): void {
  const sample = getSiteSample(conn, sampleId);
  setSampleRequestStatus(conn, sample.requestId, "posted", actor, { sampleId, postId });
}
