import type { Metadata } from "next";
import { loadBrandTokens } from "@adapters/config";
import { cloudMutationBlockedReason, resolveRuntimeMode } from "@core/runtime";
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
        {resolveRuntimeMode(process.env) === "cloud" ? (
          <div
            role="alert"
            style={{ background: "#7a1515", color: "#fff", padding: "8px 16px", fontSize: 13, lineHeight: 1.6 }}
          >
            <strong>クラウド実行モード(V5.4)。</strong>
            バックアップ/復元・書き出し・レンダリング・AI社員の実行はローカル専用機能のため、この環境では使用できません。
            {cloudMutationBlockedReason(process.env) ? " 認証が未設定のため、すべての変更操作は拒否されます(fail closed)。" : null}
            Instagram実投稿はPreview環境では構造的に無効です。
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
