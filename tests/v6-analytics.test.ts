/**
 * V6-A/B: 分析ファクトモデルとスナップショット。
 * すべて一時DBで実行。実DB・外部サービスへは触れない。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import { ensureSeedOrg, addPostMetric } from "@adapters/db/store";
import { createAnalysisSnapshot, gatherAnalyticsInput, computeSourceDataHash, latestAnalysisSnapshot } from "@adapters/db/analytics";
import {
  buildAnalysisFacts,
  canonicalJson,
  computeRates,
  findForbiddenAssertions,
  median,
  safeRate,
  type AnalyticsPostInput,
} from "@core/analytics";
import { ulid } from "@core/ids";

let dir: string;
let dbPath: string;
let opened: OpenedDb;

function insertPublishedPost(db: OpenedDb["db"], title: string, overrides: Partial<typeof t.posts.$inferInsert> = {}): string {
  const id = ulid();
  db.insert(t.posts)
    .values({
      id,
      pillar: "6",
      format: "carousel",
      title,
      status: "published",
      plannedDate: "2026-07-10",
      publishMethod: "manual",
      rightsState: "n/a",
      templateId: "tpl-howto",
      publishedAt: "2026-07-10T03:00:00.000Z",
      createdAt: "2026-07-10",
      ...overrides,
    })
    .run();
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v6a-"));
  dbPath = path.join(dir, "company.db");
  process.env.BLOOM_DB_PATH = dbPath;
  opened = openDb(dbPath);
  ensureSeedOrg(opened.db);
});
afterEach(() => {
  opened.sqlite.close();
  delete process.env.BLOOM_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("V6 率と中央値(純関数)", () => {
  it("reachがnullまたは0なら率はnull(0除算・欠損0埋め禁止)", () => {
    expect(safeRate(5, null)).toBeNull();
    expect(safeRate(5, 0)).toBeNull();
    expect(safeRate(null, 100)).toBeNull();
    expect(safeRate(5, 100)).toBe(0.05);
  });

  it("中央値はnullを除外し、0件ならnull", () => {
    expect(median([])).toBeNull();
    expect(median([null, null])).toBeNull();
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 100])).toBe(2.5); // 外れ値100に引っ張られない
  });

  it("computeRatesはnull入力でnullを返し、値を捏造しない", () => {
    expect(computeRates(null)).toBeNull();
    const rates = computeRates({ reach: 200, profileViews: 10, saves: 8, shares: null, comments: 0, dmStarts: null, followerCount: 20, measuredAt: "x" })!;
    expect(rates.saveRate).toBe(0.04);
    expect(rates.shareRate).toBeNull(); // sharesがnull → 率もnull(0にしない)
    expect(rates.commentRate).toBe(0); // 0は0として計算(未取得と区別)
  });
});

describe("V6 buildAnalysisFacts(決定的集計)", () => {
  const base: AnalyticsPostInput = {
    postId: "p1",
    title: "投稿1",
    pillar: "6",
    format: "carousel",
    templateId: "tpl-howto",
    templateVersion: 4,
    variant: "steps",
    cta: "DMで相談",
    publishedAt: "2026-07-10T03:00:00.000Z",
    metricDueOn: "2026-07-13",
    metrics: { reach: 100, profileViews: 5, saves: 4, shares: null, comments: 0, dmStarts: 1, followerCount: 20, measuredAt: "2026-07-13" },
  };

  it("nullを0にせず、未取得と0を区別する", () => {
    const facts = buildAnalysisFacts([base], 3, { today: "2026-07-17" });
    const post = facts.perPostFacts[0]!;
    expect(post.metrics!.shares).toBeNull(); // 未取得のまま
    expect(post.metrics!.comments).toBe(0); // 0は0のまま
    expect(post.missingMetrics).toContain("shares");
    expect(post.missingMetrics).not.toContain("comments");
    expect(facts.totals.entered.shares).toBeNull(); // 全件未取得の合計はnull(0にしない)
    expect(facts.totals.entered.comments).toBe(0);
  });

  it("windowDaysは混ざらない(生成した窓の値だけを持つ)", () => {
    const f3 = buildAnalysisFacts([base], 3, { today: "2026-07-17" });
    const f7 = buildAnalysisFacts([{ ...base, metrics: null, metricDueOn: "2026-07-17" }], 7, { today: "2026-07-17" });
    expect(f3.windowDays).toBe(3);
    expect(f7.windowDays).toBe(7);
    expect(f3.dataCoverage.measuredCount).toBe(1);
    expect(f7.dataCoverage.measuredCount).toBe(0); // 7日窓は未入力 — 3日窓の値で補完しない
  });

  it("グループ集計はsampleCount・evidencePostIds・中央値を持ち、10本未満はexploratory", () => {
    const posts: AnalyticsPostInput[] = [
      base,
      { ...base, postId: "p2", title: "投稿2", metrics: { ...base.metrics!, reach: 300, saves: 12 } },
      { ...base, postId: "p3", title: "投稿3", pillar: "1", metrics: null, metricDueOn: "2026-07-20" },
    ];
    const facts = buildAnalysisFacts(posts, 3, { today: "2026-07-17" });
    const pillar6 = facts.groups.find((g) => g.axis === "pillar" && g.key === "6")!;
    expect(pillar6.sampleCount).toBe(2);
    expect(pillar6.evidencePostIds).toEqual(["p1", "p2"]);
    expect(pillar6.medians.reach).toBe(200); // (100+300)/2
    expect(pillar6.medians.saveRate).toBe(0.04); // median(0.04, 0.04)
    expect(pillar6.exploratory).toBe(true); // 10本未満
    expect(pillar6.means.reach).toBeNull(); // 3件未満は平均を出さない
    // 期限別の充足状況
    expect(facts.dataCoverage.measuredCount).toBe(2);
    expect(facts.dataCoverage.notDueCount).toBe(1);
    expect(facts.evidencePostIds).toEqual(["p1", "p2"]);
    // 10本未満の断定禁止warning
    expect(facts.warnings.join(" ")).toMatch(/10本未満.*断定/);
    expect(facts.warnings.join(" ")).toMatch(/因果関係は断定できません/);
  });

  it("期限到来・未入力(overdue)を検出する", () => {
    const facts = buildAnalysisFacts(
      [{ ...base, metrics: null, metricDueOn: "2026-07-13" }],
      3,
      { today: "2026-07-17" },
    );
    expect(facts.dataCoverage.overdueCount).toBe(1);
    expect(facts.dataCoverage.overduePostIds).toEqual(["p1"]);
  });

  it("同じ入力から同じ結果(決定的)。asOfBusinessDateがfactsへ保存される", () => {
    const a = buildAnalysisFacts([base], 3, { today: "2026-07-17" });
    const b = buildAnalysisFacts([base], 3, { today: "2026-07-17" });
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(a.asOfBusinessDate).toBe("2026-07-17");
  });

  it("P2-2: periodStart/periodEndはJST業務日(UTC深夜公開は翌日扱い)", () => {
    // UTC 16:00 = JST 翌日01:00 → 業務日は2026-07-11
    const facts = buildAnalysisFacts([{ ...base, publishedAt: "2026-07-10T16:00:00.000Z" }], 3, { today: "2026-07-17" });
    expect(facts.periodStart).toBe("2026-07-11"); // slice(0,10)なら誤って2026-07-10になる
    expect(facts.periodEnd).toBe("2026-07-11");
  });
});

describe("V6 断定表現の検査(通常コード)", () => {
  it("10本未満では断定語を検出し、10本以上では因果語だけを検出する", () => {
    expect(findForbiddenAssertions("この形式が最強で効果がある", 3).length).toBeGreaterThan(0);
    expect(findForbiddenAssertions("保存率が高い傾向の可能性。追加検証が必要", 3)).toEqual([]);
    expect(findForbiddenAssertions("この形式は成功", 15)).toEqual([]); // 10本以上なら断定語は対象外
    expect(findForbiddenAssertions("この投稿のおかげで増えた", 15).length).toBeGreaterThan(0); // 因果は常に禁止
  });
});

describe("V6 分析スナップショット(冪等・append-only)", () => {
  it("同じ入力なら同じsnapshotを返し(created=false)、元データ変更でsourceDataHashが変わる", () => {
    const postId = insertPublishedPost(opened.db, "スナップショット対象");
    addPostMetric(opened.db, { postId, windowDays: 3, reach: 100, saves: 5 }, "owner");

    const first = createAnalysisSnapshot(opened.db, 3, "system", { today: "2026-07-17" });
    expect(first.created).toBe(true);
    const second = createAnalysisSnapshot(opened.db, 3, "system", { today: "2026-07-17" });
    expect(second.created).toBe(false);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.sourceDataHash).toBe(first.sourceDataHash);
    // snapshot_jsonはappend-onlyで1行のまま
    expect(opened.db.select().from(t.analysisSnapshots).all().length).toBe(1);

    // 元データ変更 → 新しいhash・新しい行
    addPostMetric(opened.db, { postId, windowDays: 3, reach: 150, saves: 5 }, "owner");
    const third = createAnalysisSnapshot(opened.db, 3, "system", { today: "2026-07-17" });
    expect(third.created).toBe(true);
    expect(third.sourceDataHash).not.toBe(first.sourceDataHash);
    expect(opened.db.select().from(t.analysisSnapshots).all().length).toBe(2);
    // 最新参照
    expect(latestAnalysisSnapshot(opened.db, 3)!.id).toBe(third.snapshotId);
  });

  it("gatherAnalyticsInputは公開済み投稿だけを対象にし、post_metricsを正本として読む", () => {
    insertPublishedPost(opened.db, "公開済み");
    const draftId = ulid();
    opened.db.insert(t.posts).values({
      id: draftId, pillar: "6", format: "carousel", title: "下書き", status: "drafting",
      publishMethod: "manual", rightsState: "n/a", templateId: "tpl-howto", createdAt: "2026-07-10",
    }).run();
    const input = gatherAnalyticsInput(opened.db, 3);
    expect(input.length).toBe(1);
    expect(input[0]!.metrics).toBeNull(); // 未入力はnull(捏造しない)
    expect(input[0]!.metricDueOn).toBe("2026-07-13"); // 公開日(JST)+3日
    // 決定的hash(同一業務日・同一入力で同一)
    expect(computeSourceDataHash(input, "2026-07-17")).toBe(computeSourceDataHash(gatherAnalyticsInput(opened.db, 3), "2026-07-17"));
    // P1-1: 業務日が変わればhashも変わる(期限判定が変わりうるため)
    expect(computeSourceDataHash(input, "2026-07-18")).not.toBe(computeSourceDataHash(input, "2026-07-17"));
  });

  it("P1-1: 入力が同じでも業務日が変わる(notDue→overdue)と新しいsnapshotになる", () => {
    // 公開2026-07-10 → 3日窓の期限は2026-07-13。未入力のまま日付だけ進める
    insertPublishedPost(opened.db, "期限跨ぎ検証");
    const dayBefore = createAnalysisSnapshot(opened.db, 3, "system", { today: "2026-07-12" });
    expect(dayBefore.created).toBe(true);
    expect(dayBefore.facts.dataCoverage.notDueCount).toBe(1); // 前日: まだ期限前
    expect(dayBefore.facts.dataCoverage.overdueCount).toBe(0);

    // 同一業務日の再実行は冪等
    const sameDay = createAnalysisSnapshot(opened.db, 3, "system", { today: "2026-07-12" });
    expect(sameDay.created).toBe(false);
    expect(sameDay.snapshotId).toBe(dayBefore.snapshotId);

    // 翌々日(期限到来後): 入力値は同じでも新しいsnapshotが作られ、overdueへ変わる
    const dayAfter = createAnalysisSnapshot(opened.db, 3, "system", { today: "2026-07-14" });
    expect(dayAfter.created).toBe(true);
    expect(dayAfter.sourceDataHash).not.toBe(dayBefore.sourceDataHash);
    expect(dayAfter.facts.dataCoverage.overdueCount).toBe(1);
    expect(dayAfter.facts.dataCoverage.notDueCount).toBe(0);
    expect(dayAfter.facts.asOfBusinessDate).toBe("2026-07-14");
  });

  it("スナップショットのJSONにAI生成文章を混ぜる経路がない(通常コードの出力のみ)", () => {
    insertPublishedPost(opened.db, "事実のみ");
    const r = createAnalysisSnapshot(opened.db, 3, "system", { today: "2026-07-17" });
    const row = opened.db.select().from(t.analysisSnapshots).where(eq(t.analysisSnapshots.id, r.snapshotId)).get()!;
    const parsed = JSON.parse(row.snapshotJson) as Record<string, unknown>;
    // buildAnalysisFactsの決定的キーだけで構成される
    expect(Object.keys(parsed).sort()).toEqual(
      ["asOfBusinessDate", "dataCoverage", "evidencePostIds", "groups", "insufficientData", "perPostFacts", "periodEnd", "periodStart", "totals", "warnings", "windowDays"],
    );
  });
});
