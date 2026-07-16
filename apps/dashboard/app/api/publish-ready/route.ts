import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { listPublishReady } from "@adapters/db/store";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** 公開準備一覧(approved/exported/published/measured)。V4-B */
export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(listPublishReady(db));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
