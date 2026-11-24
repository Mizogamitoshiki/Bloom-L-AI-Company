/**
 * doctorScanへの4つの追加検査(改善#6/#7/#8/#10)。
 * いずれもread-only(書き換えなし)で、代表者が見落としやすい状態を明示する。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// approveTemplate等がSatoriレンダリングを伴うため、全スイート並列実行時に既定5秒を超えることがある
// (単独実行では合格する負荷起因のタイムアウトが2026-07-19までに3回発生)。余裕を持たせる。
vi.setConfig({ testTimeout: 60_000 });
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  ensureSeedOrg,
  createPost,
  createTask,
  startTask,
  submitArtifact,
  submitQa,
  addPostMetric,
} from "@adapters/db/store";
import { doctorScan } from "@adapters/db/views";
import { createAnalysisSnapshot } from "@adapters/db/analytics";
import { saveImprovementProposal } from "@adapters/db/improvements";
import { addDays, businessDate, ulid } from "@core/ids";
import { approveTemplate, PLAN, COPY } from "./fixtures";
import { renderPost } from "@adapters/render/render-post";
import { eq } from "drizzle-orm";
import { findRepoRoot } from "@adapters/root";

let dir: string;
let imgDir: string;
let opened: OpenedDb;
const DATE = businessDate();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-doctor-"));
  imgDir = mkdtempSync(path.join(tmpdir(), "bloom-doctor-img-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});
afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(imgDir, { recursive: true, force: true });
});

function submitPlanAndCopy(postId: string): void {
  const planTask = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, planTask.id, "sora");
  submitArtifact(opened.db, planTask.id, PLAN, "sora");
  const copyTask = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copyTask.id, "kotoha");
  submitArtifact(opened.db, copyTask.id, COPY, "kotoha");
}

describe("改善#6: テンプレート版stale検査", () => {
  it("承認済み版のfingerprintがコードと乖離しているとerrorで検出される", () => {
    approveTemplate(opened.db, "tpl-howto");
    // 承認後にコードが変更された状態を再現(fingerprintのみ書き換え。他は本物のゲートを通した承認)
    opened.db.update(t.templateVersions).set({ fingerprint: "stale-fake-fingerprint" }).where(eq(t.templateVersions.templateId, "tpl-howto")).run();
    const findings = doctorScan(opened.db);
    const hit = findings.find((f) => f.subject === "template tpl-howto" && f.level === "error");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("fingerprintが一致しません");
  });

  it("fingerprintが一致していれば検出されない", () => {
    approveTemplate(opened.db, "tpl-howto");
    const findings = doctorScan(opened.db);
    expect(findings.some((f) => f.subject === "template tpl-howto")).toBe(false);
  });
});

describe("改善#7: QA要確認メモの集約", () => {
  it("承認待ち投稿の最新QAメモに『確認』系の文言があれば集約表示される", async () => {
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "テスト投稿", templateId: "tpl-howto" }, "aoi");
    submitPlanAndCopy(post.id);
    const render = await renderPost(opened.db, post.id, "system", { outDirBase: imgDir });
    if (render.skipped) throw new Error("skipped unexpectedly");
    const { passPostRenderVisualQa } = await import("./fixtures");
    passPostRenderVisualQa(opened.db, post.id);
    const qaTask = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId: post.id, stepKey: "qa", priority: 4 }, DATE).task;
    startTask(opened.db, qaTask.id, "shion");
    submitQa(opened.db, qaTask.id, {
      kind: "qa_report", result: "pass",
      checklist: [{ item: "誤字", ok: true }, { item: "禁止表現", ok: true }, { item: "文字切れ", ok: true }],
      issues: [],
      notes: ["CTAボタンの色コントラストがやや弱い可能性(要代表者確認)"],
    }, "shion");
    const findings = doctorScan(opened.db);
    const hit = findings.find((f) => f.subject === `post ${post.id}`);
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("要代表者確認");
  }, 60_000);

  it("確認系の文言がなければ集約表示されない", async () => {
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "テスト投稿2", templateId: "tpl-howto" }, "aoi");
    submitPlanAndCopy(post.id);
    const render = await renderPost(opened.db, post.id, "system", { outDirBase: imgDir });
    if (render.skipped) throw new Error("skipped unexpectedly");
    const { passPostRenderVisualQa } = await import("./fixtures");
    passPostRenderVisualQa(opened.db, post.id);
    const qaTask = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId: post.id, stepKey: "qa", priority: 4 }, DATE).task;
    startTask(opened.db, qaTask.id, "shion");
    submitQa(opened.db, qaTask.id, {
      kind: "qa_report", result: "pass",
      checklist: [{ item: "誤字", ok: true }, { item: "禁止表現", ok: true }, { item: "文字切れ", ok: true }],
      issues: [],
      notes: ["特に問題なし"],
    }, "shion");
    const findings = doctorScan(opened.db);
    expect(findings.some((f) => f.subject === `post ${post.id}`)).toBe(false);
  }, 60_000);
});

describe("改善#8: V6改善ループの稼働状況", () => {
  it("分析スナップショットが一度も生成されていなければwarnで示される", () => {
    const findings = doctorScan(opened.db);
    const hit = findings.find((f) => f.subject === "improvement-loop" && f.message.includes("一度も生成"));
    expect(hit).toBeDefined();
  });

  it("スナップショットがあれば未生成の指摘は出ない", () => {
    const postId = ulid();
    opened.db.insert(t.posts).values({
      id: postId, pillar: "6", format: "carousel", title: "計測済み投稿", status: "published",
      publishMethod: "manual", rightsState: "n/a", templateId: "tpl-howto",
      publishedAt: "2026-07-10T03:00:00.000Z", createdAt: "2026-07-10",
    }).run();
    addPostMetric(opened.db, { postId, windowDays: 3, reach: 100, saves: 4 }, "owner");
    createAnalysisSnapshot(opened.db, 3, "system");
    const findings = doctorScan(opened.db);
    expect(findings.some((f) => f.subject === "improvement-loop" && f.message.includes("一度も生成"))).toBe(false);
  });

  it("代表者未判断の改善提案があれば件数付きでwarnされる", () => {
    const postId = ulid();
    opened.db.insert(t.posts).values({
      id: postId, pillar: "6", format: "carousel", title: "計測済み投稿", status: "published",
      publishMethod: "manual", rightsState: "n/a", templateId: "tpl-howto",
      publishedAt: "2026-07-10T03:00:00.000Z", createdAt: "2026-07-10",
    }).run();
    addPostMetric(opened.db, { postId, windowDays: 3, reach: 100, saves: 4 }, "owner");
    const snapshotId = createAnalysisSnapshot(opened.db, 3, "system").snapshotId;
    saveImprovementProposal(opened.db, {
      kind: "improvement_proposal",
      analysisSnapshotId: snapshotId,
      authorEmployeeId: "emp_ren",
      title: "柱6でCTAを質問形にする検証",
      structuredFactRefs: [
        { scope: "post", postId, metric: "saveRate", value: 0.04 },
        { scope: "coverage", field: "measuredCount", value: 1 },
      ],
      hypothesis: "CTAを質問形にすると保存の傾向が変わる可能性がある。追加検証が必要",
      evidenceRefs: [postId],
      testVariable: "cta",
      testChange: { from: "現状のCTA", to: "質問形のCTA文", condition: "柱6×carouselのみ" },
      expectedSignal: "保存率の中央値の変化を観察する",
      proposedAction: "次回の柱6投稿1本でCTA文を質問形に変更して比較の材料を集める",
      risk: "保存率が下がる可能性。1本のみで実施し影響を限定する",
      expiresAt: addDays(businessDate(), 14),
    }, "aoi");
    const findings = doctorScan(opened.db);
    const hit = findings.find((f) => f.subject === "improvement-loop" && f.message.includes("未記録"));
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("1件");
  });
});

describe("改善#10: runs/ の保持方針", () => {
  // findRepoRoot()はプロセス内でキャッシュされ実リポジトリのruns/を指すため、
  // 実際のruns/配下に一時的な古い日付ディレクトリを作って検証し、必ず削除する。
  const staleDir = path.join(findRepoRoot(), "runs", "2000-01-01");

  afterEach(() => {
    if (existsSync(staleDir)) rmSync(staleDir, { recursive: true, force: true });
  });

  it("保持期間(7日)を超えたruns/日付ディレクトリがあればwarnで示される", () => {
    mkdirSync(staleDir, { recursive: true });
    const findings = doctorScan(opened.db);
    const hit = findings.find((f) => f.subject === "runs");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("2000-01-01");
    expect(hit!.fix).toContain("rm -rf");
  });

  it("古いディレクトリがなければ指摘は出ない", () => {
    const findings = doctorScan(opened.db);
    expect(findings.some((f) => f.subject === "runs")).toBe(false);
  });
});
