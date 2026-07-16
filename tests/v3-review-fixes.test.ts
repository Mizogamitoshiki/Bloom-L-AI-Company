/**
 * V3レビュー指摘の修正テスト(2026-07-13)。
 * 1) 公開許可範囲(scope)の構造的強制 2) 利用上限の実接続(境界値含む) 4) URL検証
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  ensureSeedOrg,
  createPost,
  createTask,
  startTask,
  submitArtifact,
  submitQa,
  decidePost,
  addSource,
  addPortfolioItem,
  updatePermission,
  checkPortfolioRights,
  listPortfolioForAi,
  recordHeavyEscalation,
  getGenerationPause,
  resumeGeneration,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { loadLimits } from "@adapters/config";
import { normalizeHttpUrl, assertSafeHttpUrl } from "@core/urls";
import { ulid, nowIso } from "@core/ids";
import { PLAN, COPY, QA_PASS, PORTFOLIO_COPY, SOURCE_A, ensureEvidenceFile, passPostRenderVisualQa } from "./fixtures";

let dir: string;
let imgDir: string;
let opened: OpenedDb;
const DATE = "2026-07-13";
const EVIDENCE = ensureEvidenceFile();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-rf3-"));
  imgDir = mkdtempSync(path.join(tmpdir(), "bloom-rf3-img-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  vi.useRealTimers();
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(imgDir, { recursive: true, force: true });
});

function makePortfolio(): { itemId: string; permissionId: string } {
  return addPortfolioItem(
    opened.db,
    {
      customerName: "テスト工務店",
      anonymousName: "泉州の工務店さま",
      siteUrl: "https://example.com/customer-site",
      testimonial: "とても迅速に対応していただき本当に助かりました。",
    },
    "owner",
  );
}

function makeHowtoPost(copy: typeof COPY, title = "scope検査投稿"): string {
  const post = createPost(opened.db, { pillar: "6", format: "carousel", title }, "aoi");
  const planTask = createTask(opened.db, { type: "plan_posts", title: `企画:${post.id}`, assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
  startTask(opened.db, planTask.id, "sora");
  submitArtifact(opened.db, planTask.id, PLAN, "sora");
  const copyTask = createTask(opened.db, { type: "write_copy", title: `コピー:${post.id}`, assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
  startTask(opened.db, copyTask.id, "kotoha");
  submitArtifact(opened.db, copyTask.id, copy, "kotoha");
  return post.id;
}

function qaTask(postId: string, stepKey = "qa"): string {
  const task = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey, priority: 4 }, DATE).task;
  startTask(opened.db, task.id, "shion");
  return task.id;
}

const SCOPE_ALL = { name: true, url: true, screenshot: true, testimonial: true };

describe("1. 公開許可範囲の構造的強制", () => {
  it("approved + scope.name=false では実名利用不可(匿名許可なしなら全面不可)", () => {
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: { ...SCOPE_ALL, name: false } }, "owner");
    const rc = checkPortfolioRights(opened.db, itemId);
    expect(rc.mode).not.toBe("customer");
    expect(rc.allowed).toBe(false); // 匿名許可もないため利用不可
    expect(rc.reason).toContain("実名");
  });

  it("approved + scope.name=true では実名利用可", () => {
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: SCOPE_ALL }, "owner");
    const rc = checkPortfolioRights(opened.db, itemId);
    expect(rc.mode).toBe("customer");
    expect(rc.displayName).toBe("テスト工務店");
  });

  it("anonymousAllowed=true でも証跡なしは拒否される", () => {
    const { itemId, permissionId } = makePortfolio();
    expect(() => updatePermission(opened.db, permissionId, { status: "pending", anonymousAllowed: true }, "owner")).toThrow(/証跡/);
    // DBを直接pending+匿名+証跡なしにしても判定側でも拒否される(二重防御)
    opened.sqlite.prepare("update customer_permissions set anonymous_allowed = 1, evidence_path = null where id = ?").run(permissionId);
    const rc = checkPortfolioRights(opened.db, itemId);
    expect(rc.allowed).toBe(false);
    expect(rc.reason).toContain("証跡");
  });

  it("scope.url=false: 顧客URLはAI向けビューから除外され、テキストに含めるとQA不合格", async () => {
    const { permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: { ...SCOPE_ALL, url: false } }, "owner");
    const ai = listPortfolioForAi(opened.db)[0]!;
    expect(ai.siteUrl).toBeNull();
    const copy = { ...COPY, body: COPY.body + "\n事例サイト: https://example.com/customer-site" };
    const postId = makeHowtoPost(copy);
    await renderPost(opened.db, postId, "system", { outDirBase: imgDir });
    expect(() => submitQa(opened.db, qaTask(postId), QA_PASS, "shion")).toThrow(/scope\.url/);
  }, 60_000);

  it("scope.screenshot=false: 画像素材(assetsPath)はレンダラー・AIへ渡らない", () => {
    const { itemId, permissionId } = addPortfolioItem(
      opened.db,
      { customerName: "テスト工務店", assetsPath: "03_portfolio/koumuten/", anonymousName: "泉州の工務店さま" },
      "owner",
    );
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: { ...SCOPE_ALL, screenshot: false } }, "owner");
    expect(listPortfolioForAi(opened.db).find((v) => v.id === itemId)!.assetsPath).toBeNull();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: SCOPE_ALL }, "owner");
    expect(listPortfolioForAi(opened.db).find((v) => v.id === itemId)!.assetsPath).toBe("03_portfolio/koumuten/");
  });

  it("scope.testimonial=false: お客様の声はAI向けビューから除外され、テキストに含めるとQA不合格", async () => {
    const { permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: { ...SCOPE_ALL, testimonial: false } }, "owner");
    expect(listPortfolioForAi(opened.db)[0]!.testimonial).toBeNull();
    const copy = { ...COPY, body: COPY.body + "\nお客様の声:「とても迅速に対応していただき本当に助かりました。」" };
    const postId = makeHowtoPost(copy);
    await renderPost(opened.db, postId, "system", { outDirBase: imgDir });
    expect(() => submitQa(opened.db, qaTask(postId), QA_PASS, "shion")).toThrow(/testimonial/);
  }, 60_000);

  it("許可範囲変更後、旧画像(旧表示名)のままの投稿は承認できない(再レンダリング要求)", async () => {
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "pending", anonymousAllowed: true, evidencePath: EVIDENCE }, "owner");
    const post = createPost(opened.db, { pillar: "5", format: "carousel", title: "実績scope変更", templateId: "tpl-portfolio", portfolioItemId: itemId }, "aoi");
    const planTask = createTask(opened.db, { type: "plan_posts", title: "企画p", assigneeId: "emp_sora", postId: post.id, stepKey: "plan", priority: 5 }, DATE).task;
    startTask(opened.db, planTask.id, "sora");
    submitArtifact(opened.db, planTask.id, { ...PLAN, pillar: "5" }, "sora");
    const copyTask = createTask(opened.db, { type: "write_copy", title: "コピーp", assigneeId: "emp_kotoha", postId: post.id, stepKey: "copy", priority: 5 }, DATE).task;
    startTask(opened.db, copyTask.id, "kotoha");
    submitArtifact(opened.db, copyTask.id, PORTFOLIO_COPY, "kotoha");
    await renderPost(opened.db, post.id, "system", { outDirBase: imgDir }); // 匿名名で画像生成
    passPostRenderVisualQa(opened.db, post.id);
    submitQa(opened.db, qaTask(post.id), QA_PASS, "shion"); // awaiting_approval

    // 許可範囲を変更(実名許可へ)→ 旧画像は匿名名のままなので承認不可
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: SCOPE_ALL }, "owner");
    expect(() => decidePost(opened.db, post.id, "approved", null, "owner")).toThrow(/再レンダリング/);
  }, 60_000);
});

describe("2. 利用上限の実接続(境界値)", () => {
  function seedUsage(chars: number): void {
    opened.sqlite
      .prepare("insert into usage_records (id, task_id, model_profile, est_input_chars, est_output_chars, wall_seconds, ts) values (?, ?, 'standard', 0, ?, 0, ?)")
      .run(ulid(), seedTaskId, chars, nowIso());
  }
  let seedTaskId: string;
  beforeEach(() => {
    seedTaskId = createTask(opened.db, { type: "research", title: "usage-seed", assigneeId: "emp_rin", stepKey: "seed", priority: 5 }, DATE).task.id;
  });

  it("上限未満なら生成タスクを作成できる", () => {
    const max = loadLimits().daily.max_est_output_chars;
    seedUsage(max - 1);
    expect(() => createTask(opened.db, { type: "plan_posts", title: "ok", assigneeId: "emp_sora", stepKey: "p1", priority: 5 }, DATE)).not.toThrow();
    expect(getGenerationPause(opened.db)).toBeNull();
  });

  it("上限と完全一致(>=)で停止し、停止設定が残る", () => {
    const max = loadLimits().daily.max_est_output_chars;
    seedUsage(max);
    expect(() => createTask(opened.db, { type: "plan_posts", title: "ng", assigneeId: "emp_sora", stepKey: "p2", priority: 5 }, DATE)).toThrow(/推定利用量/);
    expect(getGenerationPause(opened.db)).not.toBeNull();
  });

  it("上限超過でも同様に停止する", () => {
    const max = loadLimits().daily.max_est_output_chars;
    seedUsage(max + 5000);
    expect(() => createTask(opened.db, { type: "plan_posts", title: "ng2", assigneeId: "emp_sora", stepKey: "p3", priority: 5 }, DATE)).toThrow(/推定利用量/);
    expect(getGenerationPause(opened.db)).not.toBeNull();
  });

  it("その日最後のタスクで超過した場合も、成功トランザクション内で停止が保存される", () => {
    const max = loadLimits().daily.max_est_output_chars;
    seedUsage(max - 10); // 次の提出で確実に超える
    const task = createTask(opened.db, { type: "research", title: "last", assigneeId: "emp_rin", stepKey: "last", priority: 5 }, DATE).task;
    startTask(opened.db, task.id, "rin");
    submitArtifact(opened.db, task.id, { kind: "note", title: "調査メモ", body: "本文".repeat(50) }, "rin");
    // タスクは成功のまま・停止は保存済み
    expect(opened.db.select().from(t.tasks).where(eq(t.tasks.id, task.id)).get()!.status).toBe("done");
    const pause = getGenerationPause(opened.db);
    expect(pause).not.toBeNull();
    expect(pause!.reason).toContain("推定利用量");
  });

  it("翌日になっても代表者が再開するまで停止が維持される(業務日はJST基準)", () => {
    seedUsage(loadLimits().daily.max_est_output_chars);
    expect(() => createTask(opened.db, { type: "plan_posts", title: "d1", assigneeId: "emp_sora", stepKey: "d1", priority: 5 }, DATE)).toThrow();
    // runDateを翌日にしても停止は解除されない(停止はownerの再開まで維持)
    expect(() => createTask(opened.db, { type: "plan_posts", title: "d2", assigneeId: "emp_sora", stepKey: "d2", priority: 5 }, "2026-07-14")).toThrow(/停止中/);
    expect(() => resumeGeneration(opened.db, "aoi")).toThrow(/代表者/);
    resumeGeneration(opened.db, "owner");
    // 再開しても「当日(JST業務日)の利用量」が上限のままなら生成は引き続き拒否される(再開の悪用不可)
    expect(() => createTask(opened.db, { type: "plan_posts", title: "d3", assigneeId: "emp_sora", stepKey: "d3", priority: 5 }, DATE)).toThrow(/推定利用量/);
    resumeGeneration(opened.db, "owner");
    // 業務日が実際に翌日へ変われば(JST)、利用量ゼロとして作成できる
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 24 * 3600_000));
    expect(() => createTask(opened.db, { type: "plan_posts", title: "d4", assigneeId: "emp_sora", stepKey: "d4", priority: 5 }, "2026-07-14")).not.toThrow();
  });

  it("research fetch上限: 上限到達後のsource登録は拒否される", () => {
    const max = loadLimits().daily.max_research_fetches;
    for (let i = 0; i < max; i++) {
      addSource(opened.db, { ...SOURCE_A, url: `https://example.com/news/${i}` }, "rin");
    }
    expect(() => addSource(opened.db, { ...SOURCE_A, url: "https://example.com/news/over" }, "rin")).toThrow(/リサーチ取得上限/);
    // 既存URLの再登録(重複)は取得ではないので上限に関係なく既存を返す
    expect(addSource(opened.db, { ...SOURCE_A, url: "https://example.com/news/0" }, "rin").created).toBe(false);
  });

  it("heavy escalation上限: 上限到達後の昇格記録は拒否される", () => {
    const max = loadLimits().daily.max_heavy_escalations;
    const task = createTask(opened.db, { type: "qa", title: "esc", assigneeId: "emp_shion", stepKey: "esc", priority: 5 }, DATE).task;
    for (let i = 0; i < max; i++) {
      recordHeavyEscalation(opened.db, task.id, `理由${i}`, "aoi");
    }
    expect(() => recordHeavyEscalation(opened.db, task.id, "超過", "aoi")).toThrow(/昇格上限/);
  });

  it("エージェント起動上限: startedイベントが上限に達すると起動できない", () => {
    const max = loadLimits().daily.max_agent_launches;
    // beforeEachのseedタスクは未起動。max個のタスクを起動し、max+1個目で拒否される
    const ids: string[] = [];
    for (let i = 0; i < max + 1; i++) {
      ids.push(createTask(opened.db, { type: "research", title: `l${i}`, assigneeId: "emp_rin", stepKey: `l${i}`, priority: 5 }, DATE).task.id);
    }
    for (let i = 0; i < max; i++) startTask(opened.db, ids[i]!, "rin");
    expect(() => startTask(opened.db, ids[max]!, "rin")).toThrow(/起動上限/);
  });
});

describe("4. URL検証", () => {
  it("javascript:/data:/file: のsource URLは拒否される", () => {
    for (const url of ["javascript:alert(1)", "data:text/html;base64,PGI+", "file:///etc/passwd"]) {
      expect(() => addSource(opened.db, { ...SOURCE_A, url }, "rin")).toThrow();
    }
  });

  it("portfolio siteUrlもhttp/httpsのみ許可される", () => {
    expect(() => addPortfolioItem(opened.db, { customerName: "X店", siteUrl: "javascript:alert(1)" }, "owner")).toThrow(/http/);
    expect(() => addPortfolioItem(opened.db, { customerName: "Y店", siteUrl: "https://example.com/ok" }, "owner")).not.toThrow();
  });

  it("URL正規化により表記ゆれの重複登録を防止する", () => {
    const r1 = addSource(opened.db, { ...SOURCE_A, url: "https://Example.com:443/news/dup/" }, "rin");
    const r2 = addSource(opened.db, { ...SOURCE_A, url: "https://example.com/news/dup#section" }, "rin");
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.id).toBe(r1.id);
  });

  it("normalizeHttpUrl/assertSafeHttpUrlの単体挙動", () => {
    expect(normalizeHttpUrl("HTTPS://Example.com:443/a/b/")).toBe("https://example.com/a/b");
    expect(() => assertSafeHttpUrl("ftp://example.com/x")).toThrow(/http/);
  });
});
