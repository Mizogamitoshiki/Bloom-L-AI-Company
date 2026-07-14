import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { buildDailyReport } from "@adapters/db/views";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** 日報(V3-G)。DBの事実をその場で集計(保存はCLIのdaily-reportが行う) */
export function GET(req: Request): NextResponse {
  try {
    const date = new URL(req.url).searchParams.get("date") ?? undefined;
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(buildDailyReport(db, date));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
