import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { decidePost } from "@adapters/db/store";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    action: z.enum(["approve", "reject", "revise"]),
    comment: z.string().max(1000).optional(),
  })
  .strict();

/** 代表者の承認・却下・修正依頼(AC-16)。単一ユーザーMVPのためactorはowner固定 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const body: unknown = await req.json();
    const { action, comment } = bodySchema.parse(body);
    const decisionMap = { approve: "approved", reject: "rejected", revise: "revision_requested" } as const;
    const { db, sqlite } = openDb();
    try {
      const result = decidePost(db, id, decisionMap[action], comment ?? null, "owner");
      return NextResponse.json({ ok: true, ...result });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "操作に失敗しました" },
      { status: 400 },
    );
  }
}
