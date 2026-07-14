import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { updatePermission } from "@adapters/db/store";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected", "revoked"]),
    scope: z
      .object({ name: z.boolean(), url: z.boolean(), screenshot: z.boolean(), testimonial: z.boolean() })
      .strict()
      .optional(),
    anonymousAllowed: z.boolean().optional(),
    evidencePath: z.string().max(300).optional(),
    grantedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

/** 公開許可の記録・変更(代表者のみ。監査ログへ記録。証跡ファイル自体は配信しない) */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params; // permissionId
  try {
    const update = bodySchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      updatePermission(db, id, update, "owner");
      return NextResponse.json({ ok: true });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
