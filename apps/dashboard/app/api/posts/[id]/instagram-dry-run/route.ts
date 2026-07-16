import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { runInstagramDryRun } from "@adapters/instagram/publish";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * V5.2: Instagram投稿のdry-run(owner専用)。Metaへメディア作成・投稿・公開リクエストを
 * 一切送信せず、投稿予定内容と前提条件だけを検証して返す。何度実行しても投稿されない。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const { db, sqlite } = openDb();
    try {
      const report = runInstagramDryRun(db, id, "owner");
      return NextResponse.json({ ok: true, ...report });
    } finally {
      sqlite.close();
    }
  } catch (error) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 400 });
  }
}
