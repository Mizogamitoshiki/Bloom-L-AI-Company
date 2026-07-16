import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { getGenerationPause, resumeGeneration } from "@adapters/db/store";
import { brandStatus } from "@adapters/config";
import { toFriendlyMessage } from "@/lib/errors";
import { assertOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json({ generationPause: getGenerationPause(db), brand: brandStatus() });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}

const bodySchema = z.object({ action: z.literal("resume_generation") }).strict();

/** 生成停止の解除(代表者のみ・監査ログ記録。V3-H) */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertOwnerRequest(req);
    bodySchema.parse(await req.json());
    const { db, sqlite } = openDb();
    try {
      resumeGeneration(db, "owner");
      return NextResponse.json({ ok: true });
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
