import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { listMeetings } from "@adapters/db/views";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** 議事録一覧(V4-C)。保存は weekly-review skill 経由のCLIのみ(UIからは作成しない) */
export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(listMeetings(db));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
