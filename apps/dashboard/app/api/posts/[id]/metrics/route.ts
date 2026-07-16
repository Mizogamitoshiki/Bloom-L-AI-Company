import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { addPostMetric } from "@adapters/db/store";
import { postMetricInputSchema } from "@core/schemas";
import { toFriendlyMessage } from "@/lib/errors";
import { assertOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

/** 実績値の記録(V4-C, owner専用)。未入力はNULLのまま(0/推定で埋めない) */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const body: unknown = await req.json();
    const input = postMetricInputSchema.parse({ ...(body as object), postId: id });
    const { db, sqlite } = openDb();
    try {
      const r = addPostMetric(db, input, "owner");
      return NextResponse.json({ ok: true, ...r });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "入力値が不正です(数値は0以上の整数・負数不可)" }, { status: 400 });
    }
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
