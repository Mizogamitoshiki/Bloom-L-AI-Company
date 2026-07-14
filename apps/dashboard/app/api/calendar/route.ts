import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { calendarView } from "@adapters/db/views";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export function GET(req: Request): NextResponse {
  try {
    const month = new URL(req.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(calendarView(db, month));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
