import { NextResponse } from "next/server";
import { openDb } from "@adapters/db/client";
import { getEmployeeDetail } from "@adapters/db/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const { db, sqlite } = openDb();
    try {
      const detail = getEmployeeDetail(db, id);
      if (!detail) return NextResponse.json({ error: "社員が見つかりません" }, { status: 404 });
      return NextResponse.json(detail);
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "詳細の取得に失敗しました" },
      { status: 500 },
    );
  }
}
