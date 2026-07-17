/**
 * V6-I: Vercel Cron入口(準備のみ。本番Cron登録はしていない)。
 * 認証(Bearer CRON_SECRET)・環境ゲート・DB準備状態はhandleAnalyticsCronがfail closedで検査する。
 * V6時点ではどの環境でも書き込みへ到達しない(production+PostgreSQL実装完了後に初めて動く)。
 */
import { NextResponse } from "next/server";
import { handleAnalyticsCron } from "@adapters/cloud/cron";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const result = handleAnalyticsCron(req.headers.get("authorization"), process.env);
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
