import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { reschedulePost } from "@adapters/db/store";
import { toFriendlyMessage } from "@/lib/errors";
import { assertOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

/** 予定日の変更(V3-F)。監査ログに記録。Instagramへの自動・予約投稿は行わない */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const { plannedDate } = bodySchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      reschedulePost(db, id, plannedDate, "owner");
      return NextResponse.json({ ok: true });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
