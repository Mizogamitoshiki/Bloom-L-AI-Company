import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { pipelineView } from "@adapters/db/views";
import { toFriendlyMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(pipelineView(db));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json({ error: toFriendlyMessage(err) }, { status: 500 });
  }
}
