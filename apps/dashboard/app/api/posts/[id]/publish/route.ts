import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { recordPublish } from "@adapters/db/store";
import { toFriendlyMessage } from "@/lib/errors";
import { assertOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

/** 投稿済み記録(V4-B, owner専用)。exported の投稿のみ。3日/7日実績タスクを自動作成 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(_req);
    const { db, sqlite } = openDb();
    try {
      const r = recordPublish(db, id, "owner");
      return NextResponse.json({ ok: true, ...r });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
