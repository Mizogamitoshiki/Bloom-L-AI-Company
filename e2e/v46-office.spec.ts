import { expect, test } from "@playwright/test";

test.describe("V4.6 プレミアムオフィス", () => {
  test("デスクトップは参照全景と14名の実データ操作レイヤーを表示する", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");

    const scene = page.getByLabel("Bloom-L AI Company ライブオフィス");
    await expect(scene).toBeVisible();
    // 実データ駆動のクリーンなオフィス(焼き込み画像なし)。部屋・準備中部門はコード生成
    await expect(scene.locator(".office-floor")).toBeVisible();
    await expect(scene.locator(".office-room")).toHaveCount(3);
    await expect(scene.locator(".office-dept")).toHaveCount(4);
    // 参照画像の焼き込みは残っていない(偽の名前・経過時間・モデルを表示しない)
    await expect(scene.locator(".office-scene__image")).toHaveCount(0);

    const employeeButtons = scene.locator("button[data-employee]");
    await expect(employeeButtons).toHaveCount(13);
    const motionLayers = scene.locator("[data-motion-employee]");
    await expect(motionLayers).toHaveCount(13);
    await expect(page.getByRole("button", { name: /葵、AI社長補佐/ })).toBeVisible();
    await expect(scene.locator(".office-employee-card .sprite--portrait img")).toBeVisible();

    const statePairs = await scene.locator("button[data-employee]").evaluateAll((buttons) =>
      buttons.map((button) => {
        const employeeId = button.getAttribute("data-employee");
        const motion = document.querySelector(`[data-motion-employee="${employeeId}"]`);
        return [button.getAttribute("data-state"), motion?.getAttribute("data-state")];
      }),
    );
    expect(statePairs.every(([hotspotState, motionState]) => hotspotState === motionState)).toBe(true);

    await expect.poll(() => scene.locator('[data-moving="true"]').count(), { timeout: 8_000 }).toBeGreaterThan(0);
    const movingAgent = scene.locator('[data-moving="true"]').first();
    const walkAnimation = await movingAgent.locator(".office-live-agent__facing .sprite").evaluate((sprite) => getComputedStyle(sprite).animationName);
    expect(walkAnimation).toContain("office-agent-walk");

    await page.screenshot({ path: "test-results/v46-office-desktop.png", fullPage: true });
  });

  test("動きを減らす設定では人物アニメーションを停止する", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => window.localStorage.setItem("bloom.animOff", "false"));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");

    const scene = page.getByLabel("Bloom-L AI Company ライブオフィス");
    await expect(scene).toBeVisible();
    const animationNames = await scene.locator(".office-live-agent__facing .sprite").evaluateAll((images) =>
      images.map((image) => getComputedStyle(image).animationName),
    );
    expect(animationNames.every((name) => name === "none")).toBe(true);
    await expect(scene.locator('[data-moving="true"]')).toHaveCount(0);
  });

  test("モバイルは全景を縮小せず社員カードへ切り替える", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/");

    await expect(page.locator(".office-scene")).toBeHidden();
    const roster = page.getByLabel("AI社員の状態カード");
    await expect(roster).toBeVisible();
    await expect(roster.locator(".office-mobile-employee")).toHaveCount(13);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({ path: "test-results/v46-office-mobile.png", fullPage: true });
  });
});
