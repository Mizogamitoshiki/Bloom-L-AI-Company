import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { decideTemplateVersion, currentTemplateVersion, type TemplateDecision } from "@adapters/db/store";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const DECISIONS: TemplateDecision[] = ["approved", "rejected", "revision_requested"];

/** テンプレート版の承認/却下/修正依頼(owner専用)。audit template_version_decided に記録 */
export async function POST(req: Request, ctx: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  try {
    assertOwnerRequest(req);
    const { templateId } = await ctx.params;
    const body = (await req.json()) as { decision?: string; version?: number; note?: string };
    if (!body.decision || !DECISIONS.includes(body.decision as TemplateDecision)) {
      return NextResponse.json({ error: "decision は approved/rejected/revision_requested のいずれかです" }, { status: 400 });
    }
    const { db, sqlite } = openDb();
    try {
      const version = body.version ?? currentTemplateVersion(db, templateId);
      const row = decideTemplateVersion(db, { templateId, version, decision: body.decision as TemplateDecision, note: body.note }, "owner");
      return NextResponse.json({ ok: true, template: row });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
