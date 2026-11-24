/**
 * Bloom-L Instagram デザインシステム(V4.5)。
 * brand manifest と実ロゴを唯一のブランド情報源とし、投稿クリエイティブのトークンを集約する。
 * ここは通常コード(AI不使用)。テンプレートはこのトークンだけを参照し、色・寸法を直書きしない。
 *
 * 設計原則(docs/23):
 * - 1080×1350(4:5)。8pxグリッド。青(primary)と白を主役、アンバー(accent)は最小限の強調に限定。
 * - 実ロゴは縦横比固定・最小サイズ・セーフエリア厳守。文字「Bloom-L」で代用しない。
 * - 日本語のtype scale・行長・最大行数を定義し、Instagramの縮小表示でも見出し・重要語を読める。
 * - WCAG AA相当のコントラスト。薄すぎるグレー文字を使わない。
 */

export const DESIGN_SYSTEM_VERSION = "ds-v1";
/** カルーセルspec/成果物のスキーマ版。旧成果物の読み取り互換のため上げても既存は読める */
export const CAROUSEL_SCHEMA_VERSION = "carousel-v2";

export const CANVAS = { width: 1080, height: 1350 } as const;
/** セーフエリア(8pxグリッド: 9*8=72) */
export const SAFE = 72;
export const CONTENT_WIDTH = CANVAS.width - SAFE * 2; // 936
export const FONT = "Noto Sans JP";

/** 8pxグリッドの余白トークン */
export const SPACE = { xs: 8, sm: 16, md: 24, lg: 32, xl: 48, xxl: 64, xxxl: 88 } as const;
export const RADIUS = { sm: 12, md: 20, lg: 28, xl: 40, pill: 999 } as const;
export const STROKE = { hair: 2, base: 3, bold: 5 } as const;

/**
 * 日本語type scale。size=px、lh=行高倍率、weight=フォントウェイト。
 * maxLines は本文あふれ検査(通常コード)の根拠になる。
 */
export interface TypeStyle {
  size: number;
  lh: number;
  weight: 400 | 500 | 700 | 800 | 900;
  tracking?: number; // letterSpacing(px)
}
export const TYPE = {
  display: { size: 92, lh: 1.18, weight: 800 },
  h1: { size: 64, lh: 1.24, weight: 800 },
  h2: { size: 46, lh: 1.3, weight: 700 },
  h3: { size: 38, lh: 1.34, weight: 700 },
  lead: { size: 40, lh: 1.5, weight: 500 },
  body: { size: 34, lh: 1.6, weight: 400 },
  bodyStrong: { size: 34, lh: 1.6, weight: 700 },
  caption: { size: 27, lh: 1.5, weight: 400 },
  kicker: { size: 28, lh: 1.2, weight: 800, tracking: 2 },
  label: { size: 25, lh: 1.2, weight: 700 },
  stat: { size: 132, lh: 1.0, weight: 900 },
  statUnit: { size: 40, lh: 1.1, weight: 700 },
} satisfies Record<string, TypeStyle>;
export type TypeToken = keyof typeof TYPE;

/** ブランドカラー(brand manifestから注入。フォールバックはmanifest値と同じ) */
export interface BrandColors {
  primary: string;
  primaryDark: string;
  accent: string;
  surface: string;
  surfaceDark: string;
  ink: string;
  inkMuted: string;
}

/** 派生色(トークンから決定的に算出。テンプレートは直接色を書かない) */
export interface Palette extends BrandColors {
  primarySoft: string; // 薄い青(背景帯・カード)
  line: string; // 罫線
  onPrimary: string; // 青地の文字色
  accentSoft: string; // 薄いアンバー
  ok: string;
  warn: string;
  danger: string;
}

export function palette(c: BrandColors): Palette {
  return {
    ...c,
    // 2026-07-27 V8/D-18: 濃紺×ゴールド系に調和させた派生色。
    primarySoft: "#eef1f7", // 濃紺の極薄ティント(帯・カード背景)
    line: "#d7deea", // 罫線
    onPrimary: "#ffffff",
    accentSoft: "#f5ecd6", // 薄いゴールド
    ok: "#157a41",
    warn: "#b5730a",
    danger: "#c62f2f",
  };
}

/** ロゴ(実画像。data URIで埋め込む。縦横比固定) */
export interface LogoAsset {
  dataUri: string;
  width: number;
  height: number;
  sha256: string;
}

/** テンプレートに渡す描画テーマ(色+ロゴ)。fsに触れないようレンダラーが構築する */
export interface Theme {
  colors: Palette;
  logo: LogoAsset | null;
}

/** ロゴの表示幅(px)。高さは縦横比から算出。最小幅・セーフエリアの基準 */
export const LOGO_DISPLAY_WIDTH = 208;
export const LOGO_MIN_WIDTH = 168;

/** トークンの決定的シリアライズ(fingerprintの材料)。値が変わると版のfingerprintが変わる */
export function serializeTokens(): string {
  return JSON.stringify({
    v: DESIGN_SYSTEM_VERSION,
    canvas: CANVAS,
    safe: SAFE,
    space: SPACE,
    radius: RADIUS,
    stroke: STROKE,
    type: TYPE,
    logoWidth: LOGO_DISPLAY_WIDTH,
  });
}
