/**
 * V4-F アクセシビリティ検査(@axe-core/playwright)。
 * 主要画面で critical / serious 違反が 0 であることを要求する。
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES: { path: string; name: string }[] = [
  { path: "/", name: "オフィス(ホーム)" },
  { path: "/approvals", name: "承認キュー" },
  { path: "/publish", name: "公開準備" },
  { path: "/pipeline", name: "投稿パイプライン" },
  { path: "/calendar", name: "カレンダー" },
  { path: "/portfolio", name: "実績素材" },
  { path: "/reports", name: "レポート" },
  { path: "/meetings", name: "会議" },
  { path: "/settings", name: "設定" },
];

for (const p of PAGES) {
  test(`axe: ${p.name}(${p.path})に critical/serious 違反がない`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.locator("#main")).toBeVisible();
    // クライアントfetchの完了を待つ(#main内に見出しが描画される)
    await page.locator("#main h1, #main h2").first().waitFor({ state: "visible" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = serious.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.help}`).join("\n");
    expect(serious, `重大なa11y違反:\n${summary}`).toEqual([]);
  });
}
