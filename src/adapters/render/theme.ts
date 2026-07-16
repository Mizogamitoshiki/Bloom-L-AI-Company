/**
 * 描画テーマの構築(V4.5)。brand manifest + 実ロゴを唯一のブランド情報源にする。
 * ロゴはdata URIで埋め込み(縦横比固定)。文字「Bloom-L」で代用しない。
 * fingerprintの算出は render/fingerprint.ts(レンダリング実装コードもmaterialに含める)。
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { findRepoRoot } from "../root";
import { loadBrandTokens } from "../config";
import { palette, type BrandColors, type LogoAsset, type Theme } from "../../core/templates/design-system";

/** manifest値と同じ既定色(未配置時のフォールバック) */
const FALLBACK: BrandColors = {
  primary: "#0b46b8", primaryDark: "#083a97", accent: "#e8a13a",
  surface: "#ffffff", surfaceDark: "#eef2f9", ink: "#16233f", inkMuted: "#566180",
};

function brandColors(): BrandColors {
  const c = loadBrandTokens().colors;
  return {
    primary: c.primary ?? FALLBACK.primary,
    primaryDark: c.primaryDark ?? FALLBACK.primaryDark,
    accent: c.accent ?? FALLBACK.accent,
    surface: c.surface ?? FALLBACK.surface,
    surfaceDark: c.surfaceDark ?? FALLBACK.surfaceDark,
    ink: c.ink ?? FALLBACK.ink,
    inkMuted: c.inkMuted ?? FALLBACK.inkMuted,
  };
}

/** PNGのIHDRから幅・高さを取得(sync・依存なし) */
function pngSize(buf: Buffer): { width: number; height: number } {
  // 8byte署名 + 4byte length + 4byte "IHDR" のあと width(4) height(4)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 実ロゴを読み込む。@2x があれば高解像度を優先。無ければ null(doctorが警告) */
export function loadLogo(root: string = findRepoRoot()): LogoAsset | null {
  const dir = path.join(root, "data", "workspace", "01_brand");
  for (const name of ["logo@2x.png", "logo.png"]) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    const { width, height } = pngSize(buf);
    return {
      dataUri: `data:image/png;base64,${buf.toString("base64")}`,
      width,
      height,
      sha256: createHash("sha256").update(buf).digest("hex"),
    };
  }
  return null;
}

let cached: Theme | null = null;
export function loadTheme(): Theme {
  if (cached) return cached;
  cached = { colors: palette(brandColors()), logo: loadLogo() };
  return cached;
}

/** テスト用にキャッシュを破棄 */
export function resetThemeCache(): void {
  cached = null;
}

// fingerprint算出は render/fingerprint.ts に分離(レンダリング実装コードもmaterialに含めるため)
