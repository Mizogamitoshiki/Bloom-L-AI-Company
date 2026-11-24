import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { declineSampleRequest } from "@adapters/db/samples";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const declineSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

/** 代表者専用: サンプル依頼の見送り(理由必須・監査ログに記録。素材ファイルは削除しない) */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    assertOwnerRequest(req);
    const { id } = await context.params;
    const parsed = declineSchema.safeParse(await req.json());
    if (!parsed.success) throw new Error("見送りには理由(500字以内)が必要です");
    const { db, sqlite } = openDb();
    try {
      declineSampleRequest(db, id, parsed.data.reason, "owner");
      return NextResponse.json({ ok: true });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
