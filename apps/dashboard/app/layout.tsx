import type { Metadata } from "next";
import { loadBrandTokens } from "@adapters/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bloom-L AI Company",
  description: "Bloom-L AIマーケティング部 オフィスダッシュボード(ローカル)",
};

/** ブランドトークンを :root CSS変数へ注入(未配置時はプレースホルダー。docs/10) */
function tokensToCss(): string {
  const tokens = loadBrandTokens();
  const map: Record<string, string> = {
    primary: "--color-primary",
    primaryDark: "--color-primary-dark",
    accent: "--color-accent",
    surface: "--color-surface",
    surfaceDark: "--color-surface-dark",
    ink: "--color-ink",
    inkMuted: "--color-ink-muted",
    danger: "--color-danger",
    warning: "--color-warning",
    info: "--color-info",
    success: "--color-success",
    floor: "--color-floor",
    wall: "--color-wall",
  };
  const lines = Object.entries(map)
    .map(([key, cssVar]) => {
      const value = tokens.colors[key];
      return value ? `${cssVar}: ${value};` : "";
    })
    .filter(Boolean)
    .join(" ");
  return `:root { ${lines} }`;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <style dangerouslySetInnerHTML={{ __html: tokensToCss() }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          本文へスキップ
        </a>
        {children}
      </body>
    </html>
  );
}
