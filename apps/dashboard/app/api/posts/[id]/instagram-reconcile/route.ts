import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { reconcileInstagramJob } from "@adapters/instagram/publish";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z
  .discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("not_published") }).strict(),
    z.object({ outcome: z.literal("published"), instagramMediaId: z.string().regex(/^\d+$/) }).strict(),
  ]);

/** 公開結果不明(needs_reconciliation)の解消(owner UI操作のみ)。Meta APIへは何も送らない */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const body = bodySchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      const result = reconcileInstagramJob(db, id, "owner", body);
      return NextResponse.json({ ok: true, ...result });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
