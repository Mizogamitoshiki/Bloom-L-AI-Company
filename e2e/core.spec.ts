/** V4-F: 実際の代表者フロー、状態信頼性、権利、キーボード、reduced-motion、レスポンシブ。 */
import { test, expect } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";
import { openDb } from "../src/adapters/db/client";
import * as t from "../src/adapters/db/schema";
import { createTask, startTask, submitArtifact, submitQa, latestPostRender, attachPostRenderVisualQa } from "../src/adapters/db/store";
import { renderPost } from "../src/adapters/render/render-post";
import { businessDate } from "../src/core/ids";

/** テスト設定の合格visual QA(本番経路には注入しない) */
const KB_VISUAL_QA = { kind: "visual_qa" as const, result: "pass" as const, criticalIssues: [], minorIssues: [], revisionInstructions: [], pageFindings: [] };
import {
  E2E_BLOCKED_TITLE,
  E2E_COPY,
  E2E_KEYBOARD_TITLE,
  E2E_POST_TITLE,
  E2E_QA_PASS,
  E2E_REVISION_TITLE,
} from "./seed";

function postSection(page: import("@playwright/test").Page, title: string) {
  return page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::section");
}

async function expectStatus(page: import("@playwright/test").Page, message: string): Promise<void> {
  await expect(page.getByRole("status")).toContainText(message, { timeout: 30_000 });
}

test.describe.serial("V4-F コア検収シナリオ", () => {
  test.beforeEach(() => {
    // next devの初回APIコンパイルを含める。検証内容・期待値は緩和しない。
    test.setTimeout(90_000);
  });

  test("1. オフィス→状態不明→社員詳細を実イベントから確認できる", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "主要ナビゲーション" })).toBeVisible();
    const staleEmployee = page.getByRole("button", { name: /昊、コンテンツ企画担当.*停止の可能性/ });
    await expect(staleEmployee).toBeVisible();
    await staleEmployee.click();
    await page.getByRole("button", { name: "仕事の詳細を見る" }).click();
    await expect(page.getByRole("dialog", { name: "AI社員の詳細" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "AI社員の詳細" })).toContainText(/最終更新|状態不明|停止の可能性/, {
      timeout: 30_000,
    });
    await expect(page.getByRole("progressbar")).toHaveCount(0);
  });

  test("2. 権利未確認の実績投稿は承認経路へ出ない", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByText(E2E_BLOCKED_TITLE)).toHaveCount(0);
    await page.goto("/portfolio");
    const customer = page.getByText("E2E権利確認前顧客", { exact: true });
    await expect(customer).toBeVisible();
    await expect(customer.locator("xpath=ancestor::div[contains(@style,'border')]" )).toContainText(/投稿での利用可否: 不可/);
  });

  test("3. 修正依頼→再制作→version+1→再QAで承認待ちへ戻る", async ({ page }) => {
    await page.goto("/approvals");
    await page.getByRole("button", { name: new RegExp(E2E_REVISION_TITLE) }).click();
    await page.getByLabel(/コメント/).fill("見出しをより具体的にしてください");
    await page.getByRole("button", { name: "修正依頼" }).click();
    await expectStatus(page, "修正依頼を登録しました");

    // UI操作後のAI再制作部分を、一時E2E DB上で通常のcompany use-case経由で完走させる。
    const opened = openDb();
    try {
      const post = opened.db.select().from(t.posts).where(eq(t.posts.title, E2E_REVISION_TITLE)).get()!;
      const revision = opened.db
        .select().from(t.tasks)
        .where(and(eq(t.tasks.postId, post.id), eq(t.tasks.type, "write_copy"), eq(t.tasks.status, "queued")))
        .orderBy(desc(t.tasks.createdAt)).limit(1).get()!;
      startTask(opened.db, revision.id, "kotoha");
      submitArtifact(opened.db, revision.id, { ...E2E_COPY, headline: "修正版: HPがなくても始める見せ方" }, "kotoha");
      await renderPost(opened.db, post.id, "system");
      const qa = createTask(opened.db, {
        type: "qa", title: `再QA ${E2E_REVISION_TITLE}`, assigneeId: "emp_shion", postId: post.id,
        stepKey: "qa-v2", priority: 4,
      }, businessDate()).task;
      startTask(opened.db, qa.id, "shion");
      submitQa(opened.db, qa.id, E2E_QA_PASS, "shion");
      // 再レンダリングで新しいpost_renderができるため、視覚QA(紫苑相当)を紐付け直す(exportゲートを満たす)
      const render = latestPostRender(opened.db, post.id);
      if (render) attachPostRenderVisualQa(opened.db, render.id, KB_VISUAL_QA);
    } finally {
      opened.sqlite.close();
    }

    await page.reload();
    const revised = page.getByRole("button", { name: new RegExp(E2E_REVISION_TITLE) });
    await expect(revised).toBeVisible();
    await expect(revised).toContainText("copy v2");
  });

  test("4. 承認→export_bundle→人間投稿後のpublished記録をUIで完走する", async ({ page }) => {
    await page.goto("/approvals");
    await page.getByRole("button", { name: new RegExp(E2E_POST_TITLE) }).click();
    await page.getByRole("button", { name: "承認する" }).click();
    await expectStatus(page, "承認しました");

    await page.goto("/publish");
    let section = postSection(page, E2E_POST_TITLE);
    await section.getByRole("button", { name: /書き出し/ }).click();
    await expectStatus(page, "書き出しました");
    section = postSection(page, E2E_POST_TITLE);
    await section.getByRole("button", { name: /手動投稿済み/ }).click();
    await expectStatus(page, "投稿済みとして記録");
    await expect(postSection(page, E2E_POST_TITLE)).toContainText("投稿済み");
  });

  test("5. キーボードだけで承認とexportへ到達できる", async ({ page }) => {
    await page.goto("/approvals");
    const queueItem = page.getByRole("button", { name: new RegExp(E2E_KEYBOARD_TITLE) });
    await queueItem.focus();
    await page.keyboard.press("Enter");
    const approve = page.getByRole("button", { name: "承認する" });
    await approve.focus();
    await page.keyboard.press("Enter");
    await expectStatus(page, "承認しました");

    await page.goto("/publish");
    const exportButton = postSection(page, E2E_KEYBOARD_TITLE).getByRole("button", { name: /書き出し/ });
    await exportButton.focus();
    await page.keyboard.press("Enter");
    await expectStatus(page, "書き出しました");
  });

  test("6. reduced-motionでは一覧表示で同じ社員情報へ到達できる", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "オフィス表示" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("昊", { exact: true }).first()).toBeVisible();
  });

  test("7. 設定保存と週報/月報切替が維持される", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/週の投稿目標/).fill("5");
    await page.getByRole("button", { name: "保存する" }).click();
    await expectStatus(page, "保存しました");
    await page.reload();
    await expect(page.getByLabel(/週の投稿目標/)).toHaveValue("5");
    await page.goto("/reports");
    await page.getByRole("tab", { name: "週報" }).click();
    await expect(page.getByRole("tab", { name: "週報" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "月報" }).click();
    await expect(page.getByRole("tab", { name: "月報" })).toHaveAttribute("aria-selected", "true");
  });

  test("8. V5公式APIは既定で無効・秘密値なし・手動経路を維持する", async ({ page }) => {
    await page.goto("/publish");
    const card = page.getByRole("heading", { name: "Instagram公式API" }).locator("xpath=ancestor::section");
    await expect(card).toContainText("無効");
    await expect(page.getByRole("button", { name: /公式APIで公開/ })).toHaveCount(0);
    const response = await page.request.get("/api/instagram/readiness");
    expect(response.ok()).toBe(true);
    const body = await response.json() as Record<string, unknown>;
    expect(body.mode).toBe("disabled");
    expect(JSON.stringify(body)).not.toMatch(/accessToken|igUserId/);
  });
});

const RESPONSIVE_PAGES = ["/", "/approvals", "/publish", "/pipeline", "/calendar", "/portfolio", "/reports", "/meetings", "/settings", "/templates"];
for (const width of [375, 768, 1440]) {
  test(`幅${width}pxで主要9画面に重大な横スクロールがない`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    for (const route of RESPONSIVE_PAGES) {
      await page.goto(route);
      await expect(page.locator("#main")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} の横方向overflow`).toBeLessThanOrEqual(1);
    }
  });
}
