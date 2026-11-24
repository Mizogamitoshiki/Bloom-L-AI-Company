import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { updateOwnerIdea, IDEA_STATUSES } from "@adapters/db/ideas";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    status: z.enum(IDEA_STATUSES),
    resolution: z.string().max(500).optional(),
  })
  .strict();

/** アイデアの状態変更(owner UI操作のみ。見送り・完了訂正等) */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const body = bodySchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      const idea = updateOwnerIdea(db, id, { status: body.status, resolution: body.resolution }, "owner");
      return NextResponse.json({ ok: true, idea });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
