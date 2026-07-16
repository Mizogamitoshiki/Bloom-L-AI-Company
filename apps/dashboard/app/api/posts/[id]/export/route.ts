import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { exportPost } from "@adapters/db/store";
import { toFriendlyMessage } from "@/lib/errors";
import { assertOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

/** 承認済み投稿の書き出し(V4-B, owner専用)。core層が整合性・QA・権利を再検査 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const { db, sqlite } = openDb();
    try {
      const r = exportPost(db, id, "owner");
      return NextResponse.json({ ok: true, ...r });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
