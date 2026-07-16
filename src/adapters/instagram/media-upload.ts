/**
 * V5.2 公開画像アップロード(owner専用・安全ゲート付き)。
 * 承認・内容QA・視覚QA・テンプレ承認・権利・整合性をすべて通過したexport bundleの確定画像だけを、
 * MediaStoragePort(既定: Vercel Blob)経由で公開HTTPS URLへ配置し、post_media_uploadsへ記録する。
 *
 * 冪等性と補償方針:
 * - キーは content-addressed(instagram/<postId>/<index>-<sha256先頭16>.png)。同一内容の再PUTは同一URLへ収束する
 * - 同一providerで同一sha256のアップロード記録が既にあれば、外部通信せず既存URLを再利用する
 * - 全画像のアップロード成功後に、DB記録を1トランザクションで置き換える(途中失敗で不完全な行を残さない)
 * - 外部アップロード成功後にDB保存が失敗した場合: 公開Blobは残るが、キーが決定的なため再実行すれば
 *   同じURLに再収束し、DB記録も揃う(孤児Blobは上書き対象であり実害なし)。これが補償方針である
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { assertPostContentIntegrity, assertPostReadyForExternalPublish, audit } from "../db/store";
import { workspaceRoot } from "../root";
import { nowIso, ulid } from "../../core/ids";
import { assertSafePublicMediaUrl, type MediaStoragePort } from "../storage/media-storage";
import { VercelBlobStorage } from "../storage/vercel-blob";

const CANVAS = { width: 1080, height: 1350 } as const;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ExportMetaV2 {
  postId?: string;
  images?: unknown;
  imageSha256?: Record<string, string>;
}

export interface MediaUploadOutcome {
  postId: string;
  provider: string;
  images: { index: number; fileName: string; sha256: string; publicUrl: string; reused: boolean }[];
  uploadedCount: number;
  reusedCount: number;
}

/** 公開アップロード済みURL一覧(投稿順)。未実施ならnull */
export function listPostMediaUploads(db: Db, postId: string): typeof t.postMediaUploads.$inferSelect[] {
  return db
    .select()
    .from(t.postMediaUploads)
    .where(eq(t.postMediaUploads.postId, postId))
    .orderBy(asc(t.postMediaUploads.imageIndex))
    .all();
}

/**
 * export bundleの確定画像を公開ストレージへアップロードする(owner専用)。
 * §5の安全ゲートをすべて通過しない限り、外部通信は開始しない。
 */
export async function uploadPostMedia(
  db: Db,
  postId: string,
  actor: string,
  deps: { storage?: MediaStoragePort; env?: NodeJS.ProcessEnv } = {},
): Promise<MediaUploadOutcome> {
  if (actor !== "owner") throw new Error("公開画像のアップロードは代表者(owner)のみ実行できます");

  // 承認・内容QA・視覚QA・テンプレ版承認・fingerprint・design QA・権利・bundle実在(store側で一括検査)
  const ready = assertPostReadyForExternalPublish(db, postId);

  const storage = deps.storage ?? new VercelBlobStorage(deps.env ?? process.env);
  if (!storage.isConfigured()) {
    // 外部通信前に停止(絶対条件6)
    throw new Error(storage.configurationHelp());
  }

  // bundle読み込み(meta.json v2: 画像順 + export時SHA-256)
  const rel = ready.exportPath.replace(/^data\/workspace\//, "");
  const bundleDir = path.resolve(workspaceRoot(), rel);
  const metaPath = path.join(bundleDir, "meta.json");
  if (!existsSync(metaPath)) throw new Error("export bundleのmeta.jsonがありません。再書き出ししてください");
  let meta: ExportMetaV2;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8")) as ExportMetaV2;
  } catch {
    throw new Error("export bundleのmeta.jsonが壊れています。再書き出ししてください");
  }
  if (meta.postId !== postId || !Array.isArray(meta.images)) {
    throw new Error("export bundleと投稿IDまたは画像一覧が一致しません");
  }
  const images = meta.images.filter((n): n is string => typeof n === "string");
  if (images.length !== meta.images.length || images.length < 1 || images.length > 10) {
    throw new Error("公開できる画像枚数は1〜10枚です");
  }
  if (!meta.imageSha256 || typeof meta.imageSha256 !== "object") {
    throw new Error("旧形式のexport bundle(画像SHA-256なし)です。pnpm company export で再書き出ししてください");
  }

  // spec(carousel_spec)との枚数一致: 整合検査済みの最新レンダリング枚数とbundle枚数を照合
  const integrity = assertPostContentIntegrity(db, postId);
  if (integrity.imageArtifactIds.length !== images.length) {
    throw new Error(`画像枚数がspecと一致しません(bundle: ${images.length}枚 / spec: ${integrity.imageArtifactIds.length}枚)。再書き出ししてください`);
  }

  // 各画像の物理検査: 実在・PNG形式・1080×1350・export時ハッシュ一致
  const files: { index: number; fileName: string; sha256: string; data: Buffer }[] = [];
  for (let i = 0; i < images.length; i++) {
    const name = images[i]!;
    const filePath = path.join(bundleDir, name);
    if (!/^\d{2}\.png$/.test(name) || !existsSync(filePath)) {
      throw new Error(`画像ファイルが不足しています: ${name}。再書き出ししてください`);
    }
    const data = readFileSync(filePath);
    if (!data.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new Error(`PNG形式ではない画像が含まれています: ${name}`);
    }
    const metaImg = await sharp(data).metadata();
    if (metaImg.width !== CANVAS.width || metaImg.height !== CANVAS.height) {
      throw new Error(`画像解像度が不正です: ${name}(${metaImg.width}x${metaImg.height}。期待: ${CANVAS.width}x${CANVAS.height})`);
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    const expected = meta.imageSha256[name];
    if (!expected || expected !== sha256) {
      throw new Error(`画像のSHA-256がexport時と一致しません: ${name}。改ざんまたは破損の可能性があります。再書き出ししてください`);
    }
    files.push({ index: i, fileName: name, sha256, data });
  }

  // アップロード(同一hash+providerは既存URLを再利用し外部通信しない)
  const existingByHash = new Map(
    db.select().from(t.postMediaUploads).where(eq(t.postMediaUploads.provider, storage.provider)).all()
      .map((row) => [row.sha256, row.publicUrl] as const),
  );
  const results: MediaUploadOutcome["images"] = [];
  let uploadedCount = 0;
  for (const file of files) {
    const reusedUrl = existingByHash.get(file.sha256);
    if (reusedUrl) {
      assertSafePublicMediaUrl(reusedUrl);
      results.push({ index: file.index, fileName: file.fileName, sha256: file.sha256, publicUrl: reusedUrl, reused: true });
      continue;
    }
    const key = `instagram/${postId}/${String(file.index + 1).padStart(2, "0")}-${file.sha256.slice(0, 16)}.png`;
    const { url } = await storage.upload(key, file.data, "image/png");
    assertSafePublicMediaUrl(url);
    existingByHash.set(file.sha256, url);
    results.push({ index: file.index, fileName: file.fileName, sha256: file.sha256, publicUrl: url, reused: false });
    uploadedCount++;
  }

  // DB記録は全アップロード成功後に1トランザクションで置き換え(途中失敗で不完全な状態を残さない)
  const now = nowIso();
  db.transaction((tx) => {
    tx.delete(t.postMediaUploads).where(eq(t.postMediaUploads.postId, postId)).run();
    for (const row of results) {
      tx.insert(t.postMediaUploads).values({
        id: ulid(),
        postId,
        imageIndex: row.index,
        fileName: row.fileName,
        sha256: row.sha256,
        publicUrl: row.publicUrl,
        provider: storage.provider,
        uploadedAt: now,
      }).run();
    }
    audit(tx, actor, "instagram_media_uploaded", "post", postId, {
      provider: storage.provider,
      imageCount: results.length,
      uploadedCount,
      reusedCount: results.length - uploadedCount,
    });
  });

  return {
    postId,
    provider: storage.provider,
    images: results,
    uploadedCount,
    reusedCount: results.length - uploadedCount,
  };
}
