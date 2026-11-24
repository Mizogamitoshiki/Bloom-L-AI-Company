import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { addOwnerIdea, listOwnerIdeas } from "@adapters/db/ideas";
import { assertOwnerRequest } from "@/lib/owner-request";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** 代表者アイデアボックス(V7)。一覧は誰でも参照可、追加はowner UI操作のみ */
export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json({ ideas: listOwnerIdeas(db) });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}

const bodySchema = z.object({ text: z.string().min(1).max(500) }).strict();

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertOwnerRequest(req);
    const body = bodySchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      const result = addOwnerIdea(db, body.text, "owner");
      return NextResponse.json({ ok: true, ...result });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
