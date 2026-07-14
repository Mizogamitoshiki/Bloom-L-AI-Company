import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { homeView } from "@adapters/db/views";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** ホーム(オフィス)ダッシュボードの集約データ。既存 /api/state は変更せず新設 */
export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(homeView(db));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
