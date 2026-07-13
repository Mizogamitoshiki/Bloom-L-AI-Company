import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openDb } from "@adapters/db/client";
import { getArtifactFile } from "@adapters/db/store";
import { findRepoRoot } from "@adapters/root";

export const dynamic = "force-dynamic";

/** 生成画像の配信。data/workspace 配下のファイルのみ許可(パストラバーサル防止) */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const { db, sqlite } = openDb();
    let filePath: string | null = null;
    try {
      filePath = getArtifactFile(db, id)?.filePath ?? null;
    } finally {
      sqlite.close();
    }
    if (!filePath) return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });

    const workspaceRoot = path.join(findRepoRoot(), "data", "workspace") + path.sep;
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(workspaceRoot)) {
      return NextResponse.json({ error: "許可されていないパスです" }, { status: 403 });
    }
    if (!resolved.endsWith(".png")) {
      return NextResponse.json({ error: "PNG以外は配信しません" }, { status: 415 });
    }
    const buf = readFileSync(resolved);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "配信に失敗しました" },
      { status: 500 },
    );
  }
}
