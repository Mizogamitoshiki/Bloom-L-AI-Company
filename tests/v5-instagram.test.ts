import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  createPost, createTask, decidePost, ensureSeedOrg, exportPost, startTask, submitArtifact, submitQa,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { loadInstagramConfig, publicInstagramConfig } from "@adapters/instagram/config";
import { MetaInstagramClient, type InstagramPublishPlan } from "@adapters/instagram/meta-client";
import { getInstagramReadiness, publishInstagramPost } from "@adapters/instagram/publish";
import { approveTemplate, COPY, passPostRenderVisualQa, PLAN, QA_PASS } from "./fixtures";

const LIVE_ENV = {
  META_PUBLISH_MODE: "live",
  META_GRAPH_API_VERSION: "v23.0",
  META_IG_USER_ID: "17841400000000000",
  META_ACCESS_TOKEN: "test-token",
  META_MEDIA_BASE_URL: "https://media.example.com/bloom-l",
} as NodeJS.ProcessEnv;

describe("V5 Instagram設定とMeta client", () => {
  it("公開設定には秘密値を含めず、localhost画像URLはliveReadyにならない", () => {
    const config = loadInstagramConfig({ ...LIVE_ENV, META_MEDIA_BASE_URL: "http://localhost:3000/media" });
    const safe = publicInstagramConfig(config, LIVE_ENV);
    expect(JSON.stringify(safe)).not.toContain("test-token");
    expect(safe.liveReady).toBe(false);
    expect(safe.missing.join(" ")).toMatch(/公開HTTPS/);
  });

  it("公式カルーセル手順: 子コンテナ→親CAROUSEL→media_publish", async () => {
    const posts: { url: string; body: URLSearchParams }[] = [];
    let nextId = 0;
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "GET") return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      const body = init?.body as URLSearchParams;
      posts.push({ url, body });
      nextId++;
      return new Response(JSON.stringify({ id: nextId === 4 ? "ig-media-1" : `container-${nextId}` }), { status: 200 });
    });
    const client = new MetaInstagramClient(loadInstagramConfig(LIVE_ENV), fakeFetch as typeof fetch, async () => undefined);
    const result = await client.publish({ kind: "carousel", mediaUrls: ["https://media.example.com/01.png", "https://media.example.com/02.png"], caption: "本文" });
    expect(result.instagramMediaId).toBe("ig-media-1");
    expect(posts).toHaveLength(4);
    expect(posts[0]!.body.get("is_carousel_item")).toBe("true");
    expect(posts[2]!.body.get("media_type")).toBe("CAROUSEL");
    expect(posts[2]!.body.get("children")).toBe("container-1,container-2");
    expect(posts[3]!.url).toMatch(/media_publish$/);
  });
});

describe("V5 Instagram公開統合", () => {
  let dir: string;
  let ws: string;
  let opened: OpenedDb;
  let postId: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "bloom-v5-"));
    ws = mkdtempSync(path.join(tmpdir(), "bloom-v5ws-"));
    process.env.BLOOM_WORKSPACE_PATH = ws;
    opened = openDb(path.join(dir, "test.db"));
    ensureSeedOrg(opened.db);
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "V5公開テスト" }, "aoi");
    postId = post.id;
    const plan = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId, stepKey: "plan", priority: 5 }, "2026-07-15").task;
    startTask(opened.db, plan.id, "sora"); submitArtifact(opened.db, plan.id, PLAN, "sora");
    const copy = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId, stepKey: "copy", priority: 5 }, "2026-07-15").task;
    startTask(opened.db, copy.id, "kotoha"); submitArtifact(opened.db, copy.id, COPY, "kotoha");
    await renderPost(opened.db, postId, "system", { outDirBase: path.join(ws, "05_generated-posts") });
    const qa = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey: "qa", priority: 4 }, "2026-07-15").task;
    startTask(opened.db, qa.id, "shion"); submitQa(opened.db, qa.id, QA_PASS, "shion");
    decidePost(opened.db, postId, "approved", null, "owner");
    passPostRenderVisualQa(opened.db, postId);
    approveTemplate(opened.db, "tpl-howto");
    exportPost(opened.db, postId, "owner");
  }, 60_000);

  afterEach(() => {
    delete process.env.BLOOM_WORKSPACE_PATH;
    opened.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  it("dry_runはMetaへ通信せず、計画と監査だけを記録する", async () => {
    const client = { publish: vi.fn(async (_plan: InstagramPublishPlan) => { throw new Error("呼ばれてはいけない"); }) };
    const result = await publishInstagramPost(opened.db, postId, "owner", { env: { ...LIVE_ENV, META_PUBLISH_MODE: "dry_run" }, client });
    expect(result.status).toBe("dry_run");
    expect(result.plan.imageCount).toBe(6);
    expect(client.publish).not.toHaveBeenCalled();
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("exported");
    const audit = opened.db.select().from(t.auditLog).where(and(eq(t.auditLog.subjectId, postId), eq(t.auditLog.action, "instagram_publish_dry_run"))).all();
    expect(audit).toHaveLength(1);
  }, 60_000);

  it("owner以外は外部公開できない", async () => {
    await expect(publishInstagramPost(opened.db, postId, "aoi", { env: LIVE_ENV })).rejects.toThrow(/代表者/);
  });

  it("live設定不足は外部通信前・ジョブ作成前に拒否する", async () => {
    const client = { publish: vi.fn(async () => ({ childContainerIds: [], containerId: "x", instagramMediaId: "y" })) };
    const incomplete = { ...LIVE_ENV, META_ACCESS_TOKEN: "", META_IG_USER_ID: "" };
    await expect(publishInstagramPost(opened.db, postId, "owner", { env: incomplete, client })).rejects.toThrow(/設定が未完了/);
    expect(client.publish).not.toHaveBeenCalled();
    expect(opened.db.select().from(t.instagramPublishJobs).all()).toHaveLength(0);
  }, 60_000);

  it("live成功はmeta_apiで記録し、再実行はMetaを呼ばず冪等", async () => {
    const client = { publish: vi.fn(async () => ({ childContainerIds: ["c1", "c2"], containerId: "carousel-1", instagramMediaId: "ig-123" })) };
    const first = await publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client });
    const second = await publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client });
    expect(first.status).toBe("published");
    expect(second.skipped).toBe(true);
    expect(client.publish).toHaveBeenCalledTimes(1);
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    expect(post.status).toBe("published");
    expect(post.publishMethod).toBe("meta_api");
    expect(opened.db.select().from(t.instagramPublishJobs).all()).toHaveLength(1);
  }, 60_000);

  it("通信結果が不明な失敗は秘密を保存せず、二重投稿防止で再試行を拒否", async () => {
    const client = { publish: vi.fn(async () => { throw new Error(`network failed ${LIVE_ENV.META_ACCESS_TOKEN}`); }) };
    await expect(publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client })).rejects.toThrow(/二重投稿防止/);
    const job = opened.db.select().from(t.instagramPublishJobs).get()!;
    expect(job.status).toBe("needs_reconciliation");
    expect(JSON.stringify(job)).not.toContain(String(LIVE_ENV.META_ACCESS_TOKEN));
    await expect(publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client })).rejects.toThrow(/自動再試行しません/);
    expect(client.publish).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("readinessはdisabled既定で外部送信不可", () => {
    const ready = getInstagramReadiness({});
    expect(ready.mode).toBe("disabled");
    expect(ready.externalSendEnabled).toBe(false);
  });
});
