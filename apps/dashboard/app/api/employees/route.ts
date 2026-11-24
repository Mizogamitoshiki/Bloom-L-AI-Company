import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { employeesAdminView } from "@adapters/db/views";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** V7: AI社員管理(S-AI社員)。プロフィール・ペルソナ・稼働状態・実績の統合ビュー(読み取りのみ) */
export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(employeesAdminView(db));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
