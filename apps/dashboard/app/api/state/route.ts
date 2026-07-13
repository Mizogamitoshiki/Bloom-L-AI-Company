import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { getCompanyState } from "@adapters/db/store";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  try {
    const { db, sqlite } = openDb();
    try {
      return NextResponse.json(getCompanyState(db));
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "状態の取得に失敗しました" },
      { status: 500 },
    );
  }
}
