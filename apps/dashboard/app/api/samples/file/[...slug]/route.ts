import { NextResponse } from "next/server";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { workspaceRoot } from "@adapters/root";
import { SAMPLE_DIRECTORY } from "@adapters/render/sample-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const BUILT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const VERSION_DIR = /^v\d{1,3}$/;

function inside(parent: string, candidate: string): boolean {
  const rel = path.relative(parent, candidate);
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

/**
 * V10.2: サイトサンプルのファイル配信。workspace/02_site-samples 配下のみ。
 * - 画像(png/jpg/webp): 投入素材・撮影PNGのプレビュー用
 * - html/css: ビルド済みサンプル(<requestId>/v<n>/ 配下)だけ。外部リソース遮断のCSP・noindex・SAMEORIGINを付けて返す
 * slug は "02_site-samples/<requestId>/..." の workspace 相対パス(DBの safeRelativePath / dirPath と同じ形)。
 * 正規化後・realpath後ともにルート内であることを確認し、隠しファイル(一時アップロード等)は配信しない。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string[] }> }): Promise<NextResponse> {
  try {
    const { slug } = await ctx.params;
    const segments = slug.map((s) => decodeURIComponent(s));
    if (segments.length === 0 || segments.some((s) => !s || s === "." || s === ".." || s.startsWith(".") || s.includes("\\"))) {
      return notFound();
    }
    const workspace = workspaceRoot();
    const root = path.resolve(workspace, SAMPLE_DIRECTORY);
    const abs = path.resolve(workspace, ...segments);
    if (!inside(root, abs) || !existsSync(abs)) return notFound();

    const ext = path.extname(abs).toLowerCase();
    let contentType = IMAGE_TYPES[ext];
    const extraHeaders: Record<string, string> = {};
    if (!contentType) {
      const built = BUILT_TYPES[ext];
      if (!built) return notFound();
      // html/css は <requestId>/v<n>/ 配下(ビルド済みサンプル)からのみ
      const rel = path.relative(root, abs).split(path.sep);
      if (rel.length < 3 || !VERSION_DIR.test(rel[1] ?? "")) return notFound();
      contentType = built;
      extraHeaders["Content-Security-Policy"] =
        "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'";
      extraHeaders["X-Robots-Tag"] = "noindex, nofollow";
      extraHeaders["X-Frame-Options"] = "SAMEORIGIN";
    }

    const real = realpathSync(abs);
    if (!inside(realpathSync(root), real) || !statSync(real).isFile()) return notFound();
    const buf = readFileSync(real);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders },
    });
  } catch {
    return notFound();
  }
}
