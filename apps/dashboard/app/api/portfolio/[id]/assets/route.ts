import { NextResponse } from "next/server";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { openDb } from "@adapters/db/client";
import { updatePortfolioAssetsPath } from "@adapters/db/store";
import { workspaceRoot } from "@adapters/root";
import {
  MAX_PORTFOLIO_ASSET_BYTES,
  PORTFOLIO_ASSET_DIRECTORY,
  resolvePortfolioMedia,
} from "@adapters/render/portfolio-media";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

/** 代表者専用: 実績スクリーンショットを安全領域へ保存し、DBへ相対パスだけを記録する。 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  let uploaded: string | null = null;
  try {
    assertOwnerRequest(req);
    const { id } = await context.params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("実績画像ファイルを選択してください");
    const ext = EXTENSION[file.type];
    if (!ext) throw new Error("実績画像はPNG/JPEG/WebPのみ対応しています(SVG・PDFは使用不可)");
    if (file.size <= 0 || file.size > MAX_PORTFOLIO_ASSET_BYTES) {
      throw new Error(`実績画像は1byte以上${MAX_PORTFOLIO_ASSET_BYTES / 1024 / 1024}MB以下にしてください`);
    }

    const dir = path.join(workspaceRoot(), PORTFOLIO_ASSET_DIRECTORY, id);
    mkdirSync(dir, { recursive: true });
    const name = `screenshot-${randomUUID()}${ext}`;
    const temp = path.join(dir, `.${name}.upload`);
    uploaded = path.join(dir, name);
    writeFileSync(temp, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    renameSync(temp, uploaded);

    // DB更新前にSharpで実デコード・寸法・形式まで検査する。失敗時はファイルを補償削除。
    const media = await resolvePortfolioMedia(id, name);
    const { db, sqlite } = openDb();
    try {
      updatePortfolioAssetsPath(db, id, media.meta.safeRelativePath, "owner");
    } finally {
      sqlite.close();
    }
    return NextResponse.json({
      ok: true,
      assetsPath: media.meta.safeRelativePath,
      assetSha256: media.meta.assetSha256,
      width: media.meta.width,
      height: media.meta.height,
    });
  } catch (error) {
    if (uploaded) rmSync(uploaded, { force: true });
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 400 });
  }
}
