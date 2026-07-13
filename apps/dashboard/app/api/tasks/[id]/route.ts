import { NextResponse } from "next/server";
import { z } from "zod";
import { openDb } from "@adapters/db/client";
import { cancelTask, resumeTask } from "@adapters/db/store";

export const dynamic = "force-dynamic";

const actionSchema = z.object({ action: z.enum(["cancel", "resume"]) }).strict();

/** タスクの停止・再開(docs/13 §5)。操作者は単一ユーザーMVPのため owner 固定 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const body: unknown = await req.json();
    const { action } = actionSchema.parse(body);
    const { db, sqlite } = openDb();
    try {
      if (action === "cancel") cancelTask(db, id, "owner");
      else resumeTask(db, id, "owner");
      return NextResponse.json({ ok: true });
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
