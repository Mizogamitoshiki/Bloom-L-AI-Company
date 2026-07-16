/**
 * V5 Instagram公開オーケストレーター。
 * 代表者承認済みexport bundleだけを対象に、dry-run既定・live明示設定・二重投稿停止を強制する。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { assertPostReadyForExternalPublish, audit, recordPublish } from "../db/store";
import { workspaceRoot } from "../root";
import { nowIso, ulid } from "../../core/ids";
import {
  assertInstagramLiveConfig,
  loadInstagramConfig,
  publicInstagramConfig,
  type InstagramConfig,
  type InstagramPublicConfig,
} from "./config";
import { MetaApiError, MetaInstagramClient, type InstagramPublishPlan, type MetaPublishResult } from "./meta-client";

interface ExportMeta { postId?: string; images?: unknown }

export interface InstagramReadiness extends InstagramPublicConfig {
  recommendedLogin: "instagram_login";
  externalSendEnabled: boolean;
}

export interface InstagramPostPlan extends InstagramPublishPlan {
  postId: string;
  exportPath: string;
  idempotencyKey: string;
}

export interface InstagramPublishOutcome {
  mode: "dry_run" | "live";
  status: "dry_run" | "published";
  postId: string;
  jobId: string;
  instagramMediaId: string | null;
  skipped: boolean;
  plan: { kind: "image" | "carousel"; imageCount: number };
}

export function getInstagramReadiness(env: NodeJS.ProcessEnv = process.env): InstagramReadiness {
  const safe = publicInstagramConfig(loadInstagramConfig(env), env);
  return {
    ...safe,
    recommendedLogin: "instagram_login",
    externalSendEnabled: safe.mode === "live" && safe.liveReady,
  };
}

function encodePath(parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

export function buildInstagramPostPlan(db: Db, postId: string, config: InstagramConfig): InstagramPostPlan {
  const ready = assertPostReadyForExternalPublish(db, postId);
  if (!config.mediaBaseUrl || !/^https:\/\//.test(config.mediaBaseUrl)) {
    throw new Error("公開画像URLが未設定です(META_MEDIA_BASE_URL に公開HTTPS URLを設定してください)");
  }

  const rel = ready.exportPath.replace(/^data\/workspace\//, "");
  const bundleDir = path.resolve(workspaceRoot(), rel);
  const allowedRoot = path.resolve(workspaceRoot(), "05_generated-posts") + path.sep;
  if (!bundleDir.startsWith(allowedRoot) || !existsSync(bundleDir) || !statSync(bundleDir).isDirectory()) {
    throw new Error("export bundleの保存先が不正です");
  }
  const metaPath = path.join(bundleDir, "meta.json");
  const captionPath = path.join(bundleDir, "caption.txt");
  if (!existsSync(metaPath) || !existsSync(captionPath)) throw new Error("export bundleにmeta.jsonまたはcaption.txtがありません");

  let meta: ExportMeta;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8")) as ExportMeta;
  } catch {
    throw new Error("export bundleのmeta.jsonが壊れています");
  }
  if (meta.postId !== postId || !Array.isArray(meta.images)) throw new Error("export bundleと投稿IDまたは画像一覧が一致しません");
  const images = meta.images.filter((name): name is string => typeof name === "string");
  if (images.length !== meta.images.length || images.length < 1 || images.length > 10) {
    throw new Error("Instagramへ公開できる画像枚数は1〜10枚です");
  }
  if (images.some((name) => !/^\d{2}\.png$/.test(name) || !existsSync(path.join(bundleDir, name)))) {
    throw new Error("export bundleの画像名または実ファイルが不正です");
  }
  const caption = readFileSync(captionPath, "utf8").trim();
  if (!caption || caption.length > 2_200) throw new Error("キャプションは1〜2,200文字である必要があります");

  const bundleName = path.basename(bundleDir);
  const mediaUrls = images.map((name) => `${config.mediaBaseUrl}/${encodePath([bundleName, name])}`);
  const material = JSON.stringify({ postId, mediaUrls, caption });
  const digest = createHash("sha256").update(material).digest("hex");
  return {
    postId,
    exportPath: ready.exportPath,
    kind: images.length === 1 ? "image" : "carousel",
    mediaUrls,
    caption,
    idempotencyKey: digest,
  };
}

function redactError(error: unknown, token: string): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const message = (token ? raw.split(token).join("[REDACTED]") : raw).slice(0, 500);
  return { code: error instanceof MetaApiError ? error.safeCode : "UNKNOWN_REMOTE_STATE", message };
}

function finishLocalRecord(db: Db, postId: string, jobId: string, mediaId: string): void {
  const post = db.select().from(t.posts).where(eq(t.posts.id, postId)).get();
  if (!post) throw new Error("投稿が見つかりません");
  if (post.status === "exported") recordPublish(db, postId, "owner", "meta_api");
  else if (post.status !== "published" && post.status !== "measured") {
    throw new Error(`Meta公開後のローカル反映を停止しました(現在の投稿状態: ${post.status})`);
  }
  db.transaction((tx) => {
    tx.update(t.instagramPublishJobs)
      .set({ status: "published", instagramMediaId: mediaId, publishedAt: nowIso(), updatedAt: nowIso(), errorCode: null, errorMessage: null })
      .where(eq(t.instagramPublishJobs.id, jobId))
      .run();
    audit(tx, "owner", "instagram_publish_completed", "post", postId, { jobId, instagramMediaId: mediaId });
  });
}

export async function publishInstagramPost(
  db: Db,
  postId: string,
  actor: string,
  deps: { env?: NodeJS.ProcessEnv; client?: { publish(plan: InstagramPublishPlan): Promise<MetaPublishResult> } } = {},
): Promise<InstagramPublishOutcome> {
  if (actor !== "owner") throw new Error("Instagram公開は代表者(owner)のみ実行できます");
  const config = loadInstagramConfig(deps.env);
  if (config.mode === "disabled") throw new Error("Instagram公式APIは無効です(META_PUBLISH_MODE=disabled)");
  // live設定不備はジョブを作る前に拒否し、実行中に見える中途半端な行を残さない。
  if (config.mode === "live") assertInstagramLiveConfig(config);
  // 公開成功後の再クリックは、exported前提の再検査より先に完了ジョブを返す。
  // 手動公開済み等で完了ジョブがない場合はこの分岐に入らず、通常ゲートが拒否する。
  const completed = db.select().from(t.instagramPublishJobs)
    .where(and(eq(t.instagramPublishJobs.postId, postId), eq(t.instagramPublishJobs.status, "published")))
    .orderBy(desc(t.instagramPublishJobs.createdAt)).get();
  if (completed?.instagramMediaId) {
    return {
      mode: "live", status: "published", postId, jobId: completed.id,
      instagramMediaId: completed.instagramMediaId, skipped: true,
      plan: { kind: JSON.parse(completed.mediaUrlsJson).length === 1 ? "image" : "carousel", imageCount: JSON.parse(completed.mediaUrlsJson).length },
    };
  }
  const plan = buildInstagramPostPlan(db, postId, config);
  const mode = config.mode === "live" ? "live" : "dry_run";
  const idempotencyKey = `${mode}:${plan.idempotencyKey}`;
  const existing = db
    .select()
    .from(t.instagramPublishJobs)
    .where(eq(t.instagramPublishJobs.idempotencyKey, idempotencyKey))
    .orderBy(desc(t.instagramPublishJobs.createdAt))
    .get();

  if (existing?.status === "published" && existing.instagramMediaId) {
    return { mode, status: "published", postId, jobId: existing.id, instagramMediaId: existing.instagramMediaId, skipped: true, plan: { kind: plan.kind, imageCount: plan.mediaUrls.length } };
  }
  if (existing?.status === "remote_published" && existing.instagramMediaId) {
    finishLocalRecord(db, postId, existing.id, existing.instagramMediaId);
    return { mode: "live", status: "published", postId, jobId: existing.id, instagramMediaId: existing.instagramMediaId, skipped: true, plan: { kind: plan.kind, imageCount: plan.mediaUrls.length } };
  }
  if (existing && ["publishing", "needs_reconciliation"].includes(existing.status)) {
    throw new Error("前回のInstagram公開結果が未確定です。二重投稿防止のため自動再試行しません。Instagram側を確認してください");
  }

  const jobId = existing?.id ?? ulid();
  const now = nowIso();
  db.transaction((tx) => {
    if (existing) {
      tx.update(t.instagramPublishJobs)
        .set({ status: mode === "dry_run" ? "dry_run" : "publishing", mode, mediaUrlsJson: JSON.stringify(plan.mediaUrls), attemptCount: existing.attemptCount + 1, updatedAt: now, errorCode: null, errorMessage: null })
        .where(eq(t.instagramPublishJobs.id, existing.id)).run();
    } else {
      tx.insert(t.instagramPublishJobs).values({
        id: jobId, postId, idempotencyKey, mode,
        status: mode === "dry_run" ? "dry_run" : "publishing",
        mediaUrlsJson: JSON.stringify(plan.mediaUrls), attemptCount: 1, createdAt: now, updatedAt: now,
      }).run();
    }
    audit(tx, actor, mode === "dry_run" ? "instagram_publish_dry_run" : "instagram_publish_started", "post", postId, {
      jobId, kind: plan.kind, imageCount: plan.mediaUrls.length,
    });
  });

  if (mode === "dry_run") {
    return { mode, status: "dry_run", postId, jobId, instagramMediaId: null, skipped: false, plan: { kind: plan.kind, imageCount: plan.mediaUrls.length } };
  }

  const client = deps.client ?? new MetaInstagramClient(config);
  let remote: MetaPublishResult;
  try {
    remote = await client.publish(plan);
  } catch (error) {
    const safe = redactError(error, config.accessToken);
    db.transaction((tx) => {
      tx.update(t.instagramPublishJobs)
        .set({ status: "needs_reconciliation", errorCode: safe.code, errorMessage: safe.message, updatedAt: nowIso() })
        .where(eq(t.instagramPublishJobs.id, jobId)).run();
      audit(tx, actor, "instagram_publish_needs_reconciliation", "post", postId, { jobId, errorCode: safe.code });
    });
    throw new Error(`${safe.message}。二重投稿防止のため、Instagram側を確認するまで再試行できません`);
  }

  db.transaction((tx) => {
    tx.update(t.instagramPublishJobs).set({
      status: "remote_published",
      childContainerIdsJson: JSON.stringify(remote.childContainerIds),
      carouselContainerId: remote.containerId,
      instagramMediaId: remote.instagramMediaId,
      updatedAt: nowIso(),
    }).where(eq(t.instagramPublishJobs.id, jobId)).run();
    audit(tx, actor, "instagram_remote_publish_recorded", "post", postId, { jobId, instagramMediaId: remote.instagramMediaId });
  });
  finishLocalRecord(db, postId, jobId, remote.instagramMediaId);
  return { mode, status: "published", postId, jobId, instagramMediaId: remote.instagramMediaId, skipped: false, plan: { kind: plan.kind, imageCount: plan.mediaUrls.length } };
}

export function latestInstagramJob(db: Db, postId: string): typeof t.instagramPublishJobs.$inferSelect | null {
  return db.select().from(t.instagramPublishJobs).where(and(eq(t.instagramPublishJobs.postId, postId))).orderBy(desc(t.instagramPublishJobs.createdAt)).get() ?? null;
}
