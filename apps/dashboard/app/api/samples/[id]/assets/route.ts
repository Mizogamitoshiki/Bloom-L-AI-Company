import { NextResponse } from "next/server";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { addSampleAsset } from "@adapters/db/samples";
import { MAX_SAMPLE_ASSET_BYTES, sampleInputDir } from "@adapters/render/sample-media";
import { SAMPLE_ASSET_KINDS } from "@core/schemas";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

const kindSchema = z.enum(SAMPLE_ASSET_KINDS);

/**
 * 代表者専用: サンプル素材(design/hero/logo/photo/reference)を
 * workspace/02_site-samples/<requestId>/input/ へ保存し、DBへ相対パス・hash・寸法だけを記録する。
 * クライアントのファイル名は使わず、種別+UUIDで安全な名前を付ける。失敗時はファイルを補償削除。
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  let temp: string | null = null;
  let uploaded: string | null = null;
  try {
    assertOwnerRequest(req);
    const { id } = await context.params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("素材画像ファイルを選択してください");
    const kindParsed = kindSchema.safeParse(form.get("kind"));
    if (!kindParsed.success) throw new Error(`素材の種別は ${SAMPLE_ASSET_KINDS.join("/")} のいずれかを選択してください`);
    const ext = EXTENSION[file.type];
    if (!ext) throw new Error("素材画像はPNG/JPEG/WebPのみ対応しています(SVG・PDFは使用不可)");
    if (file.size <= 0 || file.size > MAX_SAMPLE_ASSET_BYTES) {
      throw new Error(`素材画像は1byte以上${MAX_SAMPLE_ASSET_BYTES / 1024 / 1024}MB以下にしてください`);
    }

    const dir = sampleInputDir(id);
    mkdirSync(dir, { recursive: true });
    const name = `${kindParsed.data}-${randomUUID()}${ext}`;
    temp = path.join(dir, `.${name}.upload`);
    writeFileSync(temp, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    uploaded = path.join(dir, name);
    renameSync(temp, uploaded);
    temp = null;

    // DB登録前にSharpで実デコード・寸法・形式まで検査する(addSampleAsset内)。失敗時はファイルを補償削除。
    const { db, sqlite } = openDb();
    try {
      const asset = await addSampleAsset(db, id, { fileName: name, kind: kindParsed.data }, "owner");
      return NextResponse.json({ ok: true, asset });
    } finally {
      sqlite.close();
    }
  } catch (error) {
    if (temp) rmSync(temp, { force: true });
    if (uploaded) rmSync(uploaded, { force: true });
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 400 });
  }
}
