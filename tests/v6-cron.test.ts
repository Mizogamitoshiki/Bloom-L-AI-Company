/**
 * V6-H/I: Instagram Insights境界とCron-ready基盤。
 * 外部通信ゼロ(fetch監視で検証)。実Cron・実投稿・Meta通信は発生しない。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import { ensureSeedOrg, addPostMetric } from "@adapters/db/store";
import { handleAnalyticsCron, runScheduledAnalytics } from "@adapters/cloud/cron";
import { InstagramInsightsSource, ManualMetricsSource, loadInsightsMode, resolveMetricsSource } from "@adapters/instagram/metrics-source";
import { ulid } from "@core/ids";

let dir: string;
let opened: OpenedDb;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v6c-"));
  const dbPath = path.join(dir, "company.db");
  process.env.BLOOM_DB_PATH = dbPath;
  opened = openDb(dbPath);
  ensureSeedOrg(opened.db);
  const postId = ulid();
  opened.db.insert(t.posts).values({
    id: postId, pillar: "6", format: "carousel", title: "cron対象", status: "published",
    publishMethod: "manual", rightsState: "n/a", templateId: "tpl-howto",
    publishedAt: "2026-07-10T03:00:00.000Z", createdAt: "2026-07-10",
  }).run();
  addPostMetric(opened.db, { postId, windowDays: 3, reach: 50 }, "owner");
});
afterEach(() => {
  opened.sqlite.close();
  delete process.env.BLOOM_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("V6-H Instagram Insights境界(実装なし・通信なし)", () => {
  it("INSTAGRAM_INSIGHTS_MODEは既定disabled。不正値もdisabledへ倒す(fail closed)", () => {
    expect(loadInsightsMode({})).toBe("disabled");
    expect(loadInsightsMode({ INSTAGRAM_INSIGHTS_MODE: "" })).toBe("disabled");
    expect(loadInsightsMode({ INSTAGRAM_INSIGHTS_MODE: "bogus" })).toBe("disabled");
    expect(loadInsightsMode({ INSTAGRAM_INSIGHTS_MODE: "dry_run" })).toBe("dry_run");
  });

  it("Insights providerはliveでもMetaへ通信せず「未実装」を正直に返す", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const source = new InstagramInsightsSource({ INSTAGRAM_INSIGHTS_MODE: "live" } as NodeJS.ProcessEnv);
    expect(source.isConfigured()).toBe(false); // 実装が無い間は「構成済み」と偽らない
    const result = await source.fetchPostMetrics({ postId: "p", instagramMediaId: "m", windowDays: 3 });
    expect(result.fetched).toBe(false);
    expect(result.metrics).toBeNull();
    expect(result.reason).toMatch(/未実装/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("既定のprovider解決はmanual(手動入力が正)", async () => {
    const source = resolveMetricsSource({});
    expect(source.provider).toBe("manual");
    expect(source instanceof ManualMetricsSource).toBe(true);
    const result = await source.fetchPostMetrics({ postId: "p", instagramMediaId: "m", windowDays: 3 });
    expect(result.fetched).toBe(false); // 手動入力経路を案内するだけ
  });
});

describe("V6-I scheduled analytics(決定的・冪等)", () => {
  it("dry-runはDBへ書き込まない", () => {
    const before = opened.db.select().from(t.analysisSnapshots).all().length;
    const result = runScheduledAnalytics(opened.db, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.metaApiCalled).toBe(false);
    expect(result.aiInvoked).toBe(false);
    expect(result.windows.length).toBe(2); // 3日窓・7日窓
    expect(opened.db.select().from(t.analysisSnapshots).all().length).toBe(before);
  });

  it("実行は冪等(同一入力の再実行で新規スナップショットを作らない)", () => {
    const first = runScheduledAnalytics(opened.db, { dryRun: false });
    expect(first.windows.every((w) => w.created)).toBe(true);
    const second = runScheduledAnalytics(opened.db, { dryRun: false });
    expect(second.windows.every((w) => !w.created)).toBe(true);
    expect(second.windows.map((w) => w.sourceDataHash)).toEqual(first.windows.map((w) => w.sourceDataHash));
    expect(opened.db.select().from(t.analysisSnapshots).all().length).toBe(2);
    // 実行後のdry-runもwouldCreate=false(冪等の可視化)
    const dry = runScheduledAnalytics(opened.db, { dryRun: true });
    expect(dry.windows.every((w) => !w.wouldCreate)).toBe(true);
  });

  it("処理中に外部通信(fetch)を行わない", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    runScheduledAnalytics(opened.db, { dryRun: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("V6-I /api/cron/analytics 認証・環境ゲート", () => {
  const SECRET = "cron-secret-value-EXAMPLE";
  const auth = `Bearer ${SECRET}`;

  it("CRON_SECRET未設定は401", () => {
    const r = handleAnalyticsCron(auth, {});
    expect(r.status).toBe(401);
  });

  it("Bearer不一致・ヘッダーなしは401", () => {
    expect(handleAnalyticsCron("Bearer wrong-value", { CRON_SECRET: SECRET }).status).toBe(401);
    expect(handleAnalyticsCron(null, { CRON_SECRET: SECRET }).status).toBe(401);
  });

  it("正しいBearerでもpreviewは拒否(403)", () => {
    const r = handleAnalyticsCron(auth, { CRON_SECRET: SECRET, VERCEL_ENV: "preview" });
    expect(r.status).toBe(403);
    expect(String(r.body.error)).toMatch(/production以外/);
  });

  it("productionでもSQLite(cloud)は503 not_ready", () => {
    const r = handleAnalyticsCron(auth, { CRON_SECRET: SECRET, VERCEL_ENV: "production" });
    expect(r.status).toBe(503);
    expect(r.body.notReady).toBe(true);
    expect(String(r.body.error)).toMatch(/SQLite/);
  });

  it("productionでもPostgreSQL未実装は503 not_ready(書き込み・外部通信へ到達しない)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const openSpy = vi.fn();
    const r = handleAnalyticsCron(
      auth,
      { CRON_SECRET: SECRET, VERCEL_ENV: "production", DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://u:PASS-EXAMPLE@h/db" },
      { openDbForWrite: openSpy },
    );
    expect(r.status).toBe(503);
    expect(String(r.body.error)).toMatch(/PostgreSQL.*未実装/);
    expect(openSpy).not.toHaveBeenCalled(); // DBオープンにも到達しない
    expect(fetchSpy).not.toHaveBeenCalled(); // Meta等への通信なし
  });

  it("応答・エラーへ秘密値(CRON_SECRET・DATABASE_URL)を出さない", () => {
    for (const r of [
      handleAnalyticsCron("Bearer wrong", { CRON_SECRET: SECRET }),
      handleAnalyticsCron(auth, { CRON_SECRET: SECRET, VERCEL_ENV: "preview" }),
      handleAnalyticsCron(auth, { CRON_SECRET: SECRET, VERCEL_ENV: "production", DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://u:PASS-EXAMPLE@h/db" }),
    ]) {
      const text = JSON.stringify(r.body);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("PASS-EXAMPLE");
    }
  });
});

describe("V6再レビューP1-3: 分析読み取りのクラウド保護", () => {
  it("ローカル(既定)は従来どおり閲覧可能(ブロックなし)", async () => {
    const { cloudSensitiveReadBlockedReason } = await import("@core/runtime");
    expect(cloudSensitiveReadBlockedReason({})).toBeNull();
    expect(cloudSensitiveReadBlockedReason({ APP_RUNTIME_MODE: "local" })).toBeNull();
  });

  it("Preview/Production/cloud指定で認証未確定なら読み取りをfail closedで拒否する", async () => {
    const { cloudSensitiveReadBlockedReason } = await import("@core/runtime");
    for (const env of [
      { VERCEL_ENV: "preview" },
      { VERCEL_ENV: "production" },
      { APP_RUNTIME_MODE: "cloud" },
      { VERCEL_ENV: "production", OWNER_AUTH_PROVIDER: "basic" }, // 未実装providerも拒否
    ]) {
      const reason = cloudSensitiveReadBlockedReason(env);
      expect(reason, JSON.stringify(env)).toBeTruthy();
      // 拒否応答は理由文字列のみで構成され、amountYen・anonymizedNote等のデータを含まない
      const blockedBody = JSON.stringify({ error: reason });
      expect(blockedBody).not.toMatch(/amountYen|anonymizedNote|proposals|decision/);
    }
  });
});
