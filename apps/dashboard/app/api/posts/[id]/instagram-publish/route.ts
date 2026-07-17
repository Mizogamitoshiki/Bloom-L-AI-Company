import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { loadInstagramConfig } from "@adapters/instagram/config";
import { publishInstagramPost } from "@adapters/instagram/publish";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  confirmation: z.string().optional(),
  confirmedPostId: z.string().optional(),
  confirmedTitle: z.string().optional(),
}).strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    if (loadInstagramConfig().mode === "live" && body.confirmation !== "PUBLISH_TO_INSTAGRAM") {
      throw new Error("実投稿の確認が完了していません");
    }
    const { db, sqlite } = openDb();
    try {
      const result = await publishInstagramPost(db, id, "owner", {
        confirmation: body.confirmation === "PUBLISH_TO_INSTAGRAM"
          ? { confirmedPostId: body.confirmedPostId ?? "", confirmedTitle: body.confirmedTitle ?? "" }
          : undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    } finally {
      sqlite.close();
    }
  } catch (error) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 400 });
  }
}
