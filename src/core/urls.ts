/**
 * URL検証・正規化(V3レビュー指摘4)。
 * source URL / portfolio site URL は http/https のみ許可(javascript:/data:/file:等を拒否)。
 */
export function assertSafeHttpUrl(raw: string, label = "URL"): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label}の形式が不正です: ${raw.slice(0, 80)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}はhttp/httpsのみ許可されています(拒否: ${url.protocol})`);
  }
  return url;
}

/**
 * 重複登録防止のための正規化:
 * スキーム/ホストを小文字化、既定ポート・フラグメントを除去、末尾スラッシュを統一(ルート以外は除去)。
 */
export function normalizeHttpUrl(raw: string, label = "URL"): string {
  const url = assertSafeHttpUrl(raw, label);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}
