/**
 * V5.5: Instagram公開の失敗回復。
 * - コンテナ準備待ちの一時エラー(9007等)はポーリング続行(実運用2026-07-19の失敗の再発防止)
 * - prepare段階(media_publish未到達)の失敗は「未公開」と断定し、failedとして再実行を許す
 * - publish段階の失敗のみneeds_reconciliation(結果不明)とし、代表者の確認記録で解消する
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  createPost, createTask, decidePost, ensureSeedOrg, exportPost, startTask, submitArtifact, submitQa,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { loadInstagramConfig } from "@adapters/instagram/config";
import { MetaApiError, MetaInstagramClient, type InstagramPublishPlan } from "@adapters/instagram/meta-client";
import { publishInstagramPost, reconcileInstagramJob, runInstagramDryRun } from "@adapters/instagram/publish";
import { approveTemplate, COPY, passPostRenderVisualQa, PLAN, QA_PASS } from "./fixtures";

const LIVE_ENV = {
  META_PUBLISH_MODE: "live",
  META_GRAPH_API_VERSION: "v23.0",
  META_IG_USER_ID: "17841400000000000",
  META_ACCESS_TOKEN: "test-token",
  META_MEDIA_BASE_URL: "https://media.example.com/bloom-l",
} as NodeJS.ProcessEnv;

describe("V5.5 meta-client: 準備待ちの一時エラー耐性と失敗段階の追跡", () => {
  it("状態照会が一時的に9007を返しても失敗にせず、FINISHEDまでポーリングを続ける", async () => {
    let statusCalls = 0;
    let postCalls = 0;
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") {
        statusCalls++;
        if (statusCalls <= 2) {
          return new Response(JSON.stringify({ error: { code: 9007, message: "Media ID is not available" } }), { status: 400 });
        }
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      }
      postCalls++;
      const isPublish = String(input).includes("media_publish");
      return new Response(JSON.stringify({ id: isPublish ? "ig-media-1" : `container-${postCalls}` }), { status: 200 });
    });
    const client = new MetaInstagramClient(loadInstagramConfig(LIVE_ENV), fakeFetch as typeof fetch, async () => undefined);
    const result = await client.publish({ kind: "image", mediaUrls: ["https://media.example.com/01.png"], caption: "本文" });
    expect(result.instagramMediaId).toBe("ig-media-1");
    expect(statusCalls).toBeGreaterThanOrEqual(3);
  });

  it("コンテナ作成の失敗はphase=prepare(未公開と断定できる)", async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), { status: 401 }));
    const client = new MetaInstagramClient(loadInstagramConfig(LIVE_ENV), fakeFetch as typeof fetch, async () => undefined);
    const error = await client
      .publish({ kind: "carousel", mediaUrls: ["https://m.example.com/1.png", "https://m.example.com/2.png"], caption: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).phase).toBe("prepare");
  });

  it("media_publish呼び出しの失敗はphase=publish(結果不明)", async () => {
    let postCalls = 0;
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "GET") return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      postCalls++;
      if (url.includes("media_publish")) {
        return new Response(JSON.stringify({ error: { code: 1, message: "An unknown error occurred" } }), { status: 500 });
      }
      return new Response(JSON.stringify({ id: `container-${postCalls}` }), { status: 200 });
    });
    const client = new MetaInstagramClient(loadInstagramConfig(LIVE_ENV), fakeFetch as typeof fetch, async () => undefined);
    const error = await client
      .publish({ kind: "image", mediaUrls: ["https://m.example.com/1.png"], caption: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).phase).toBe("publish");
  });
});

describe("V5.5 公開失敗の回復フロー(統合)", () => {
  let dir: string, ws: string, opened: OpenedDb, postId: string;
  const confirmation = { confirmedPostId: "", confirmedTitle: "V55回復テスト" };

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "bloom-v55-"));
    ws = mkdtempSync(path.join(tmpdir(), "bloom-v55ws-"));
    process.env.BLOOM_WORKSPACE_PATH = ws;
    opened = openDb(path.join(dir, "test.db"));
    ensureSeedOrg(opened.db);
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "V55回復テスト" }, "aoi");
    postId = post.id;
    confirmation.confirmedPostId = postId;
    const plan = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId, stepKey: "plan", priority: 5 }, "2026-07-19").task;
    startTask(opened.db, plan.id, "sora"); submitArtifact(opened.db, plan.id, PLAN, "sora");
    const copy = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId, stepKey: "copy", priority: 5 }, "2026-07-19").task;
    startTask(opened.db, copy.id, "kotoha"); submitArtifact(opened.db, copy.id, COPY, "kotoha");
    await renderPost(opened.db, postId, "system", { outDirBase: path.join(ws, "05_generated-posts") });
    passPostRenderVisualQa(opened.db, postId);
    const qa = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey: "qa", priority: 4 }, "2026-07-19").task;
    startTask(opened.db, qa.id, "shion"); submitQa(opened.db, qa.id, QA_PASS, "shion");
    decidePost(opened.db, postId, "approved", null, "owner");
    approveTemplate(opened.db, "tpl-howto");
    exportPost(opened.db, postId, "owner");
    runInstagramDryRun(opened.db, postId, "owner", { env: LIVE_ENV });
  }, 60_000);

  afterEach(() => {
    delete process.env.BLOOM_WORKSPACE_PATH;
    opened.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  function prepareFailClient(): { publish: ReturnType<typeof vi.fn> } {
    return {
      publish: vi.fn(async (_plan: InstagramPublishPlan) => {
        const error = new MetaApiError("9007", "Meta APIエラー(9007): Media ID is not available");
        error.phase = "prepare";
        throw error;
      }),
    };
  }

  it("prepare段階の失敗はfailedになり、再実行で成功できる(needs_reconciliationで止まらない)", async () => {
    const failing = prepareFailClient();
    await expect(publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client: failing, confirmation }))
      .rejects.toThrow(/Instagramには投稿されていません/);
    let job = opened.db.select().from(t.instagramPublishJobs).get()!;
    expect(job.status).toBe("failed");

    const working = { publish: vi.fn(async () => ({ childContainerIds: ["c1"], containerId: "carousel-1", instagramMediaId: "ig-777" })) };
    const result = await publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client: working, confirmation });
    expect(result.status).toBe("published");
    job = opened.db.select().from(t.instagramPublishJobs).get()!;
    expect(job.status).toBe("published");
    expect(job.attemptCount).toBe(2);
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("published");
  }, 60_000);

  it("結果不明(needs_reconciliation)は「未投稿を確認」の記録で再実行可能になる", async () => {
    const unknownFail = { publish: vi.fn(async () => { throw new Error("network failed mid-publish"); }) };
    await expect(publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client: unknownFail, confirmation }))
      .rejects.toThrow(/二重投稿防止/);
    expect(opened.db.select().from(t.instagramPublishJobs).get()!.status).toBe("needs_reconciliation");

    // owner以外は解消できない
    expect(() => reconcileInstagramJob(opened.db, postId, "aoi", { outcome: "not_published" })).toThrow(/代表者/);

    const r = reconcileInstagramJob(opened.db, postId, "owner", { outcome: "not_published" });
    expect(r.status).toBe("failed");

    const working = { publish: vi.fn(async () => ({ childContainerIds: [], containerId: "x", instagramMediaId: "ig-888" })) };
    const result = await publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client: working, confirmation });
    expect(result.status).toBe("published");
  }, 60_000);

  it("結果不明は「投稿されていた」の記録(メディアID付き)でpublishedへ揃う", async () => {
    const unknownFail = { publish: vi.fn(async () => { throw new Error("network failed mid-publish"); }) };
    await expect(publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client: unknownFail, confirmation }))
      .rejects.toThrow(/二重投稿防止/);

    expect(() => reconcileInstagramJob(opened.db, postId, "owner", { outcome: "published", instagramMediaId: "abc" })).toThrow(/メディアID/);
    const r = reconcileInstagramJob(opened.db, postId, "owner", { outcome: "published", instagramMediaId: "17900000000000001" });
    expect(r.status).toBe("published");
    const job = opened.db.select().from(t.instagramPublishJobs).get()!;
    expect(job.status).toBe("published");
    expect(job.instagramMediaId).toBe("17900000000000001");
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    expect(post.status).toBe("published");
  }, 60_000);

  it("確認待ちでないジョブはreconcileできない", async () => {
    const working = { publish: vi.fn(async () => ({ childContainerIds: [], containerId: "x", instagramMediaId: "ig-1" })) };
    await publishInstagramPost(opened.db, postId, "owner", { env: LIVE_ENV, client: working, confirmation });
    expect(() => reconcileInstagramJob(opened.db, postId, "owner", { outcome: "not_published" })).toThrow(/確認待ち/);
  }, 60_000);
});
