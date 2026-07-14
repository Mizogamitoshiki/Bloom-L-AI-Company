/**
 * V3再レビュー指摘の修正テスト(2026-07-13)。
 * P1-1: AI向け実績情報の完全マスク / P1-2: Asia/Tokyo基準の日次上限 / P1-3: 許可証跡の実在確認
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import {
  ensureSeedOrg,
  createTask,
  startTask,
  addPortfolioItem,
  updatePermission,
  checkPortfolioRights,
  listPortfolioForAi,
  recordHeavyEscalation,
  evidenceFileStatus,
  getGenerationPause,
  EVIDENCE_DIR,
} from "@adapters/db/store";
import { loadLimits } from "@adapters/config";
import { findRepoRoot } from "@adapters/root";
import { businessDate, businessDateFromIso, ulid, nowIso } from "@core/ids";
import { ensureEvidenceFile } from "./fixtures";

let dir: string;
let opened: OpenedDb;
const EVIDENCE = ensureEvidenceFile();
const SCOPE_ALL = { name: true, url: true, screenshot: true, testimonial: true };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-rf4-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});

afterEach(() => {
  vi.useRealTimers();
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function makePortfolio(): { itemId: string; permissionId: string } {
  return addPortfolioItem(
    opened.db,
    {
      customerName: "テスト工務店",
      anonymousName: "泉州の工務店さま",
      siteUrl: "https://example.com/customer-site",
      summary: "予約導線の整理",
      problem: "電話のみの予約受付",
      technologies: ["Next.js"],
      testimonial: "とても迅速に対応していただき本当に助かりました。",
    },
    "owner",
  );
}

/** 顧客由来情報が一切含まれないことの検証 */
function expectFullyMasked(view: ReturnType<typeof listPortfolioForAi>[number]): void {
  expect(view.usable).toBe(false);
  expect(view.displayName).toBeNull();
  expect(view.siteUrl).toBeNull();
  expect(view.testimonial).toBeNull();
  expect(view.assetsPath).toBeNull();
  expect(view.summary).toBeNull();
  expect(view.problem).toBeNull();
  expect(view.technologies).toEqual([]);
  expect(Object.values(view.allowedUses).every((v) => v === false)).toBe(true);
  // 生JSONにも顧客名・URL・声が現れない
  const raw = JSON.stringify(view);
  expect(raw).not.toContain("テスト工務店");
  expect(raw).not.toContain("customer-site");
  expect(raw).not.toContain("迅速に対応");
}

describe("P1-1: AI向け実績情報の完全マスク", () => {
  it("pending(利用不可)は全項目マスク", () => {
    makePortfolio();
    expectFullyMasked(listPortfolioForAi(opened.db)[0]!);
  });

  it("rejected / revoked は全項目マスク", () => {
    const a = makePortfolio();
    updatePermission(opened.db, a.permissionId, { status: "rejected" }, "owner");
    expectFullyMasked(listPortfolioForAi(opened.db).find((v) => v.id === a.itemId)!);
    updatePermission(opened.db, a.permissionId, { status: "revoked" }, "owner");
    expectFullyMasked(listPortfolioForAi(opened.db).find((v) => v.id === a.itemId)!);
  });

  it("期限切れ(approved+expiresAt過去)は全項目マスク", () => {
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: SCOPE_ALL, expiresAt: "2020-01-01" }, "owner");
    expectFullyMasked(listPortfolioForAi(opened.db).find((v) => v.id === itemId)!);
  });

  it("不正なscope_json(approved)は全不許可として全項目マスク", () => {
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: EVIDENCE, scope: SCOPE_ALL }, "owner");
    opened.sqlite.prepare("update customer_permissions set scope_json = 'not-json' where id = ?").run(permissionId);
    expectFullyMasked(listPortfolioForAi(opened.db).find((v) => v.id === itemId)!);
  });

  it("anonymous利用可能な場合は匿名名+非特定情報のみ返る(実名系はnull)", () => {
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "pending", anonymousAllowed: true, evidencePath: EVIDENCE }, "owner");
    const view = listPortfolioForAi(opened.db).find((v) => v.id === itemId)!;
    expect(view.usable).toBe(true);
    expect(view.displayName).toBe("泉州の工務店さま");
    expect(view.siteUrl).toBeNull();
    expect(view.testimonial).toBeNull();
    expect(view.assetsPath).toBeNull();
    expect(view.summary).toBe("予約導線の整理");
    expect(view.technologies).toEqual(["Next.js"]);
    expect(JSON.stringify(view)).not.toContain("テスト工務店");
  });
});

describe("P1-2: Asia/Tokyo基準の日次上限", () => {
  it("businessDateの境界: JST 00:00直前・直後 / 08:59・09:00", () => {
    // JST 2026-07-13 23:59:59 = UTC 14:59:59 → 業務日は7/13
    expect(businessDate(new Date("2026-07-13T14:59:59Z"))).toBe("2026-07-13");
    // JST 2026-07-14 00:00:00 = UTC 15:00:00 → 業務日は7/14へ切り替わる
    expect(businessDate(new Date("2026-07-13T15:00:00Z"))).toBe("2026-07-14");
    // JST 08:59(UTC前日23:59)とJST 09:00(UTC同日00:00)は同じ業務日
    // (naiveなUTC日付比較だとここで日付が割れて上限を迂回できてしまう)
    expect(businessDate(new Date("2026-07-12T23:59:00Z"))).toBe("2026-07-13");
    expect(businessDate(new Date("2026-07-13T00:00:00Z"))).toBe("2026-07-13");
    expect(businessDateFromIso("2026-07-13T15:00:00.000Z")).toBe("2026-07-14");
  });

  it("JST深夜(00:30)でもmax_agent_launchesを迂回できない", () => {
    // JST 2026-07-14 00:30 = UTC 2026-07-13 15:30(UTC日付は前日=naive比較なら別日扱いになる時間帯)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T15:30:00Z"));
    const max = loadLimits().daily.max_agent_launches;
    const date = businessDate(); // 2026-07-14
    const ids: string[] = [];
    for (let i = 0; i < max + 1; i++) {
      ids.push(createTask(opened.db, { type: "research", title: `l${i}`, assigneeId: "emp_rin", stepKey: `l${i}`, priority: 5 }, date).task.id);
    }
    for (let i = 0; i < max; i++) startTask(opened.db, ids[i]!, "rin");
    expect(() => startTask(opened.db, ids[max]!, "rin")).toThrow(/起動上限/);
  });

  it("JST深夜でもmax_heavy_escalationsを迂回できない", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T15:30:00Z")); // JST 7/14 00:30
    const max = loadLimits().daily.max_heavy_escalations;
    const task = createTask(opened.db, { type: "qa", title: "esc", assigneeId: "emp_shion", stepKey: "esc", priority: 5 }, businessDate()).task;
    for (let i = 0; i < max; i++) recordHeavyEscalation(opened.db, task.id, `r${i}`, "aoi");
    expect(() => recordHeavyEscalation(opened.db, task.id, "over", "aoi")).toThrow(/昇格上限/);
  });

  it("JST深夜でもmax_est_output_charsを迂回できない(usageは業務日で集計)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T15:30:00Z")); // JST 7/14 00:30(UTC日付は7/13)
    const seedTask = createTask(opened.db, { type: "research", title: "seed", assigneeId: "emp_rin", stepKey: "seed", priority: 5 }, businessDate()).task;
    opened.sqlite
      .prepare("insert into usage_records (id, task_id, model_profile, est_input_chars, est_output_chars, wall_seconds, ts) values (?, ?, 'standard', 0, ?, 0, ?)")
      .run(ulid(), seedTask.id, loadLimits().daily.max_est_output_chars, nowIso());
    // naiveなUTC比較(substr)ならts=7/13でrunDate=7/14と不一致→迂回できてしまうが、JST集計では検出される
    expect(() =>
      createTask(opened.db, { type: "plan_posts", title: "bypass", assigneeId: "emp_sora", stepKey: "bp", priority: 5 }, businessDate()),
    ).toThrow(/推定利用量/);
    expect(getGenerationPause(opened.db)).not.toBeNull();
  });
});

describe("P1-3: 許可証跡の実在確認", () => {
  it("絶対パス・「..」・フォルダ外・存在しないファイル・ディレクトリを拒否する", () => {
    expect(evidenceFileStatus("/etc/passwd").reason).toMatch(/絶対パス/);
    expect(evidenceFileStatus("07_customer-permissions/../01_brand/logo.png").reason).toMatch(/\.\./u);
    expect(evidenceFileStatus("03_portfolio/evidence.png").reason).toMatch(/配下のみ/);
    expect(evidenceFileStatus("07_customer-permissions/no-such-file.png").reason).toMatch(/存在しません/);
    // ディレクトリは拒否
    const subdir = path.join(findRepoRoot(), "data", "workspace", EVIDENCE_DIR, "_test-dir");
    mkdirSync(subdir, { recursive: true });
    expect(evidenceFileStatus("07_customer-permissions/_test-dir").reason).toMatch(/ファイルではありません/);
    // 実在する通常ファイルはOK
    expect(evidenceFileStatus(EVIDENCE).ok).toBe(true);
  });

  it("APIレイヤ相当: 偽パスではapproved/匿名許可を記録できない", () => {
    const { permissionId } = makePortfolio();
    for (const bad of ["/etc/passwd", "07_customer-permissions/../../secrets.png", "07_customer-permissions/ghost.png"]) {
      expect(() =>
        updatePermission(opened.db, permissionId, { status: "approved", evidencePath: bad, scope: SCOPE_ALL }, "owner"),
      ).toThrow(/許可を記録できません/);
      expect(() =>
        updatePermission(opened.db, permissionId, { status: "pending", anonymousAllowed: true, evidencePath: bad }, "owner"),
      ).toThrow(/許可を記録できません/);
    }
  });

  it("記録後に証跡ファイルが消えた場合、判定時にも拒否される(承認・利用不可)", () => {
    const name = `_test-evidence-${Date.now()}.png`;
    const rel = ensureEvidenceFile(name);
    const { itemId, permissionId } = makePortfolio();
    updatePermission(opened.db, permissionId, { status: "approved", evidencePath: rel, scope: SCOPE_ALL }, "owner");
    expect(checkPortfolioRights(opened.db, itemId).allowed).toBe(true);
    rmSync(path.join(findRepoRoot(), "data", "workspace", rel));
    const rc = checkPortfolioRights(opened.db, itemId);
    expect(rc.allowed).toBe(false);
    expect(rc.reason).toMatch(/証跡/);
    expectFullyMasked(listPortfolioForAi(opened.db).find((v) => v.id === itemId)!);
  });
});
