import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { uploadPostMedia } from "@adapters/instagram/media-upload";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * V5.2: export bundleの確定画像を公開ストレージ(Vercel Blob)へ準備する(owner専用)。
 * §5の安全ゲート(承認・QA・視覚QA・テンプレ承認・権利・整合性・PNG/解像度/hash)を通過しない限り
 * 外部通信は開始されない。トークン等の秘密値はレスポンスへ含めない。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const { db, sqlite } = openDb();
    try {
      const result = await uploadPostMedia(db, id, "owner");
      return NextResponse.json({
        ok: true,
        postId: result.postId,
        provider: result.provider,
        imageCount: result.images.length,
        uploadedCount: result.uploadedCount,
        reusedCount: result.reusedCount,
        urls: result.images.map((image) => image.publicUrl),
      });
    } finally {
      sqlite.close();
    }
  } catch (error) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 400 });
  }
}
