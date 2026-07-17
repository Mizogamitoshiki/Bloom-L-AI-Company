/**
 * V6-C: 改善提案へのCEO判断(owner専用)。
 * decideImprovementProposal(core)がactor=owner以外を拒否する。判断履歴はappend-only。
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { decideImprovementProposal } from "@adapters/db/improvements";
import { IMPROVEMENT_DECISIONS } from "@core/schemas";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    decision: z.enum(IMPROVEMENT_DECISIONS),
    reason: z.string().max(500).optional(),
  })
  .strict();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    assertOwnerRequest(req);
    const body = bodySchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      const result = decideImprovementProposal(db, { proposalId: id, decision: body.decision, reason: body.reason }, "owner");
      return NextResponse.json({ ok: true, ...result });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
