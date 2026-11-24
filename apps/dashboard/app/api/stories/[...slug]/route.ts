import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "@adapters/root";

export const dynamic = "force-dynamic";

/**
 * V8(D-18): ストーリー画像の配信。data/workspace/08_stories 配下のPNGのみ。
 * パストラバーサル防止のため、正規化後にストーリールート内であることを確認する。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string[] }> }): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    const root = path.join(workspaceRoot(), "08_stories");
    const abs = path.normalize(path.join(root, ...slug.map((s) => decodeURIComponent(s))));
    if (!abs.startsWith(root + path.sep) || !abs.endsWith(".png") || !existsSync(abs)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const buf = readFileSync(abs);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
