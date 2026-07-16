import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { buildDailyReport, buildPeriodReport } from "@adapters/db/views";
import { weekRange, monthRange, todayLocal } from "@core/ids";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * レポート(V3-G日報 + V4週報/月報)。DBの事実をその場で集計。
 * ?kind=daily|weekly|monthly &date=YYYY-MM-DD(基準日)
 */
export function GET(req: Request): NextResponse {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "daily";
    const date = url.searchParams.get("date") ?? todayLocal();
    const { db, sqlite } = openDb();
    try {
      if (kind === "weekly") {
        const { start, end } = weekRange(date);
        return NextResponse.json(buildPeriodReport(db, "weekly", start, end));
      }
      if (kind === "monthly") {
        const { start, end } = monthRange(date);
        return NextResponse.json(buildPeriodReport(db, "monthly", start, end));
      }
      return NextResponse.json(buildDailyReport(db, date));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 400 });
  }
}
