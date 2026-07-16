/**
 * V4-C: 週報/月報(決定的集計・投稿10本未満は断定禁止)+ 議事録保存/一覧。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import { ensureSeedOrg, createPost, saveMeeting } from "@adapters/db/store";
import { buildPeriodReport, listMeetings } from "@adapters/db/views";
import { weekRange, monthRange } from "@core/ids";

let dir: string;
let opened: OpenedDb;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v4r-"));
  opened = openDb(path.join(dir, "test.db"));
  ensureSeedOrg(opened.db);
});
afterEach(() => {
  opened.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("V4-C: 週報/月報", () => {
  it("投稿10本未満はデータ不足の注記が付き、決定的に同じ結果を返す", () => {
    // createdAtはbusinessDate()で当日。当日を含む週で集計
    createPost(opened.db, { pillar: "6", format: "carousel", title: "A" }, "aoi");
    createPost(opened.db, { pillar: "3", format: "carousel", title: "B" }, "aoi");
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const { start, end } = weekRange(today);
    const r1 = buildPeriodReport(opened.db, "weekly", start, end);
    const r2 = buildPeriodReport(opened.db, "weekly", start, end);
    expect(r1).toEqual(r2); // 決定的
    expect(r1.reportKind).toBe("weekly");
    expect(r1.periodStart).toBe(start);
    expect(r1.stats.postsCreated).toBe(2);
    expect(r1.dataNote).toMatch(/データ不足/);
  });

  it("同じ投稿を作成数+公開数で二重計上せず、3日/7日累積指標は最新だけを使う", () => {
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "公開済み1本" }, "aoi");
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    opened.db.update(t.posts).set({ status: "published", publishedAt: `${today}T01:00:00.000Z` }).where(eq(t.posts.id, post.id)).run();
    opened.db.insert(t.postMetrics).values({ id: "m3", postId: post.id, measuredAt: `${today}T02:00:00.000Z`, windowDays: 3, reach: 100, saves: 4 }).run();
    opened.db.insert(t.postMetrics).values({ id: "m7", postId: post.id, measuredAt: `${today}T03:00:00.000Z`, windowDays: 7, reach: 180, saves: 9 }).run();
    const { start, end } = weekRange(today);
    const report = buildPeriodReport(opened.db, "weekly", start, end);
    expect(report.dataNote).toMatch(/投稿10本未満/); // 1本を作成+公開の2本として数えない
    expect(report.lines.join("\n")).toContain("リーチ 180");
    expect(report.lines.join("\n")).not.toContain("リーチ 280");
    expect(report.stats.snsMetricsEntered).toBe(1);
  });

  it("月報も期間で集計できる", () => {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const { start, end } = monthRange(today);
    const r = buildPeriodReport(opened.db, "monthly", start, end);
    expect(r.reportKind).toBe("monthly");
    expect(r.periodStart).toBe(start);
    expect(r.periodEnd).toBe(end);
    expect(typeof r.stats.approved).toBe("number");
  });
});

describe("V4-C: 議事録保存/一覧", () => {
  const minutes = {
    kind: "meeting_minutes" as const,
    meetingKind: "weekly" as const,
    heldOn: "2026-07-14",
    periodStart: "2026-07-07",
    periodEnd: "2026-07-13",
    participants: ["葵", "湊", "蓮"],
    agenda: ["先週の振り返り"],
    facts: ["投稿2本作成"],
    observations: ["柱⑥が中心"],
    proposals: ["柱③を1本増やす仮説"],
    decisions: [],
    ownerActions: ["承認キューの消化"],
    nextWeekPlan: ["週3本(柱⑥×2, 柱③×1)"],
  };

  it("saveMeetingで議事録+meetingsが記録され、listMeetingsで読める", () => {
    const r = saveMeeting(opened.db, minutes, "aoi");
    expect(r.meetingId).toBeTruthy();
    const list = listMeetings(opened.db);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("weekly");
    expect(list[0]!.minutes?.proposals).toContain("柱③を1本増やす仮説");
    // meeting_minutes 成果物が保存されている
    const art = opened.db.select().from(t.artifacts).where(eq(t.artifacts.kind, "meeting_minutes")).all();
    expect(art.length).toBeGreaterThanOrEqual(1);
  });

  it("AI社員はdecisionsを保存できず、owner確認後の再保存は最新へ置換される", () => {
    saveMeeting(opened.db, minutes, "aoi");
    expect(() => saveMeeting(opened.db, { ...minutes, decisions: ["未承認の決定"] }, "aoi")).toThrow(/代表者/);
    saveMeeting(opened.db, { ...minutes, decisions: ["柱③を週1本に決定(代表者承認)"] }, "owner");
    const list = listMeetings(opened.db);
    expect(list).toHaveLength(1);
    expect(list[0]!.decisions).toContain("柱③を週1本に決定(代表者承認)");
    const audit = opened.db.select().from(t.auditLog).where(eq(t.auditLog.action, "meeting_decisions_confirmed")).all();
    expect(audit).toHaveLength(1);
  });

  it("不正な議事録(必須欠落)は拒否される", () => {
    expect(() => saveMeeting(opened.db, { kind: "meeting_minutes", meetingKind: "weekly" }, "aoi")).toThrow();
  });
});
