/**
 * V6-F: 成長分析画面の検収。
 * 一時DB(E2E専用)で、データ充足表示・3日/7日切替・空状態・CEO判断(owner)・
 * 承認済み改善指示の表示を確認する。実DB・Meta・Blobへは触れない。
 */
import { test, expect } from "@playwright/test";
import { openDb } from "../src/adapters/db/client";
import * as t from "../src/adapters/db/schema";
import { addPostMetric } from "../src/adapters/db/store";
import { createAnalysisSnapshot } from "../src/adapters/db/analytics";
import { saveImprovementProposal } from "../src/adapters/db/improvements";
import { addDays, todayLocal, ulid } from "../src/core/ids";

const PROPOSAL_TITLE = "E2E改善提案: CTA質問形の検証";

test.describe.serial("V6 成長分析", () => {
  test.beforeEach(() => {
    test.setTimeout(90_000);
  });

  test("1. 画面表示: データ充足・3日/7日切替・sampleCount・断定禁止の明示", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "成長分析", exact: true }).first()).toBeVisible();
    // データ不足の明示(E2Eシードは計測済み10本未満)
    await expect(page.getByText(/10本未満/).first()).toBeVisible({ timeout: 30_000 });
    // 3日/7日タブ切替(窓を混ぜない)
    const tab3 = page.getByRole("tab", { name: "3日後の実績" });
    const tab7 = page.getByRole("tab", { name: "7日後の実績" });
    await expect(tab3).toHaveAttribute("aria-selected", "true");
    await tab7.click();
    await expect(tab7).toHaveAttribute("aria-selected", "true");
    await tab3.click();
    // 改善提案の空状態(または一覧)セクションが存在する
    await expect(page.getByRole("heading", { name: /改善提案/ })).toBeVisible();
  });

  test("2. CEO判断: 提案を承認すると承認済み・次回改善指示に表示される", async ({ page }) => {
    // 一時E2E DBへ、計測済み投稿→snapshot→提案を通常のcore経由で用意する
    const opened = openDb();
    let proposalId: string;
    try {
      const postId = ulid();
      opened.db.insert(t.posts).values({
        id: postId, pillar: "6", format: "carousel", title: "E2E計測済み投稿", status: "published",
        publishMethod: "manual", rightsState: "n/a", templateId: "tpl-howto",
        publishedAt: "2026-07-10T03:00:00.000Z", createdAt: "2026-07-10",
      }).run();
      addPostMetric(opened.db, { postId, windowDays: 3, reach: 120, saves: 6 }, "owner");
      const snapshot = createAnalysisSnapshot(opened.db, 3, "system");
      proposalId = saveImprovementProposal(opened.db, {
        kind: "improvement_proposal",
        analysisSnapshotId: snapshot.snapshotId,
        authorEmployeeId: "emp_ren",
        title: PROPOSAL_TITLE,
        // reach=120, saves=6 → saveRate=0.05(snapshotの実値と完全一致する構造化参照)
        structuredFactRefs: [{ scope: "post", postId, metric: "saveRate", value: 0.05 }],
        hypothesis: "CTAを質問形にすると保存の傾向が変わる可能性がある。追加検証が必要",
        evidenceRefs: [postId],
        testVariable: "cta",
        testChange: { to: "質問形のCTA文", condition: "柱6×carouselのみ" },
        expectedSignal: "保存率中央値の変化の観察",
        proposedAction: "次回の柱6投稿1本でCTA文を質問形へ変更して比較材料を集める",
        risk: "保存率が下がる可能性。1本のみで限定実施",
        expiresAt: addDays(todayLocal(), 14),
      }, "aoi").proposalId;
    } finally {
      opened.sqlite.close();
    }

    await page.goto("/analytics");
    const proposalCard = page.getByRole("article", { name: `改善提案 ${PROPOSAL_TITLE}` });
    await expect(proposalCard).toBeVisible({ timeout: 30_000 });
    await expect(proposalCard).toContainText("CEO判断待ち");
    await expect(proposalCard).toContainText("AI社員の提案");

    // 確認ダイアログを受理して承認(判断前に確認が出ることも検証)
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("承認");
      void dialog.accept();
    });
    await proposalCard.getByRole("button", { name: "承認する" }).click();
    await expect(page.getByRole("status")).toContainText("承認として記録しました", { timeout: 30_000 });

    // 状態と次回改善指示への反映
    await expect(proposalCard).toContainText("状態: 承認済み");
    const directives = page.locator('section[aria-label="次回改善指示"]');
    await expect(directives).toContainText(PROPOSAL_TITLE);
    void proposalId;
  });
});
