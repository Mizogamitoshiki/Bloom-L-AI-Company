import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "@adapters/root";

export const dynamic = "force-dynamic";

/**
 * ゴールデンプレビュー画像の配信(V4.5)。data/workspace/06_template-previews 配下のPNGのみ。
 * パストラバーサル防止のため、正規化後にプレビュールート内であることを確認する。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string[] }> }): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    const root = path.join(workspaceRoot(), "06_template-previews");
    const abs = path.normalize(path.join(root, ...slug));
    if (!abs.startsWith(root + path.sep) || !abs.endsWith(".png") || !existsSync(abs)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const buf = readFileSync(abs);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
