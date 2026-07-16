/**
 * V5.2: 公開画像URL連携(Vercel Blob port)+ Instagram dry-run。
 * 外部サービスはすべてモック。テスト中にVercel Blob・Metaへ実通信しない。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import {
  createPost, createTask, decidePost, ensureSeedOrg, exportPost, startTask, submitArtifact, submitQa,
  latestPostRender,
} from "@adapters/db/store";
import { renderPost } from "@adapters/render/render-post";
import { uploadPostMedia, listPostMediaUploads } from "@adapters/instagram/media-upload";
import { runInstagramDryRun } from "@adapters/instagram/publish";
import { assertSafePublicMediaUrl, type MediaStoragePort } from "@adapters/storage/media-storage";
import { VercelBlobStorage } from "@adapters/storage/vercel-blob";
import { approveTemplate, COPY, passPostRenderVisualQa, PLAN, QA_PASS } from "./fixtures";

const DATE = "2026-07-16";

/** テスト用モックストレージ(実通信なし) */
function mockStorage(overrides: Partial<MediaStoragePort> = {}): MediaStoragePort & { calls: string[] } {
  const calls: string[] = [];
  return {
    provider: "mock-storage",
    isConfigured: () => true,
    configurationHelp: () => "モック未設定",
    upload: async (key: string) => {
      calls.push(key);
      return { url: `https://public.example.com/${key}` };
    },
    calls,
    ...overrides,
  } as MediaStoragePort & { calls: string[] };
}

describe("V5.2 URL安全検証(通常コード)", () => {
  it("HTTP・危険スキーム・localhost・トークン入りURLを拒否する", () => {
    expect(() => assertSafePublicMediaUrl("http://example.com/a.png")).toThrow(/HTTPS/);
    expect(() => assertSafePublicMediaUrl("file:///etc/passwd")).toThrow(/HTTPS/);
    expect(() => assertSafePublicMediaUrl("data:image/png;base64,AAAA")).toThrow(/HTTPS/);
    expect(() => assertSafePublicMediaUrl("javascript:alert(1)")).toThrow(/HTTPS|不正/);
    expect(() => assertSafePublicMediaUrl("https://localhost/a.png")).toThrow(/ローカル/);
    expect(() => assertSafePublicMediaUrl("https://127.0.0.1/a.png")).toThrow(/ローカル/);
    expect(() => assertSafePublicMediaUrl("https://cdn.example.com/a.png?access_token=abc")).toThrow(/トークン/);
    expect(() => assertSafePublicMediaUrl("https://cdn.example.com/a.png")).not.toThrow();
  });
});

describe("V5.2 Vercel Blob adapter(実通信なし)", () => {
  it("トークン未設定時は外部通信前に日本語で停止する", async () => {
    const fetchSpy = vi.fn();
    const storage = new VercelBlobStorage({} as NodeJS.ProcessEnv, fetchSpy as never);
    expect(storage.isConfigured()).toBe(false);
    await expect(storage.upload("instagram/x/01.png", Buffer.from("x"), "image/png")).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("設定済みならPUTし、返URLを安全検証して返す(トークンは戻り値に含まれない)", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => ({ url: `https://blob.public.example.com/${url.split("/").slice(3).join("/")}` }),
    }));
    const storage = new VercelBlobStorage({ BLOB_READ_WRITE_TOKEN: "blob-secret" } as NodeJS.ProcessEnv, fetchSpy as never);
    const r = await storage.upload("instagram/p1/01-abc.png", Buffer.from("png"), "image/png");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(r.url.startsWith("https://")).toBe(true);
    expect(JSON.stringify(r)).not.toContain("blob-secret");
  });
});

describe("V5.2 公開画像アップロード + dry-run 統合", () => {
  let dir: string; let ws: string; let opened: OpenedDb; let postId: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "bloom-v52-"));
    ws = mkdtempSync(path.join(tmpdir(), "bloom-v52ws-"));
    process.env.BLOOM_WORKSPACE_PATH = ws;
    opened = openDb(path.join(dir, "test.db"));
    ensureSeedOrg(opened.db);
    const post = createPost(opened.db, { pillar: "6", format: "carousel", title: "V5.2公開画像テスト" }, "aoi");
    postId = post.id;
    const plan = createTask(opened.db, { type: "plan_posts", title: "企画", assigneeId: "emp_sora", postId, stepKey: "plan", priority: 5 }, DATE).task;
    startTask(opened.db, plan.id, "sora"); submitArtifact(opened.db, plan.id, PLAN, "sora");
    const copy = createTask(opened.db, { type: "write_copy", title: "コピー", assigneeId: "emp_kotoha", postId, stepKey: "copy", priority: 5 }, DATE).task;
    startTask(opened.db, copy.id, "kotoha"); submitArtifact(opened.db, copy.id, COPY, "kotoha");
    await renderPost(opened.db, postId, "system", { outDirBase: path.join(ws, "05_generated-posts") });
    passPostRenderVisualQa(opened.db, postId);
    const qa = createTask(opened.db, { type: "qa", title: "QA", assigneeId: "emp_shion", postId, stepKey: "qa", priority: 4 }, DATE).task;
    startTask(opened.db, qa.id, "shion"); submitQa(opened.db, qa.id, QA_PASS, "shion");
    decidePost(opened.db, postId, "approved", null, "owner");
    approveTemplate(opened.db, "tpl-howto");
    exportPost(opened.db, postId, "owner");
  }, 60_000);

  afterEach(() => {
    delete process.env.BLOOM_WORKSPACE_PATH;
    opened.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  function bundleDir(): string {
    const post = opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!;
    return path.join(ws, post.exportPath!.replace(/^data\/workspace\//, ""));
  }

  it("成功: 全画像をアップロードし、順序・SHA-256・URL・providerをDBへ記録する", async () => {
    const storage = mockStorage();
    const r = await uploadPostMedia(opened.db, postId, "owner", { storage });
    expect(r.images).toHaveLength(6);
    expect(r.uploadedCount).toBe(6);
    const rows = listPostMediaUploads(opened.db, postId);
    expect(rows.map((x) => x.imageIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.every((x) => x.publicUrl.startsWith("https://public.example.com/"))).toBe(true);
    expect(rows.every((x) => /^[0-9a-f]{64}$/.test(x.sha256))).toBe(true);
    expect(rows.every((x) => x.provider === "mock-storage")).toBe(true);
  }, 60_000);

  it("再実行は冪等: 同一hashは既存URLを再利用し外部通信しない", async () => {
    const storage = mockStorage();
    await uploadPostMedia(opened.db, postId, "owner", { storage });
    const before = storage.calls.length;
    const r2 = await uploadPostMedia(opened.db, postId, "owner", { storage });
    expect(r2.uploadedCount).toBe(0);
    expect(r2.reusedCount).toBe(6);
    expect(storage.calls.length).toBe(before); // 追加アップロードなし
  }, 60_000);

  it("owner以外・actor未指定(system)は拒否する", async () => {
    const storage = mockStorage();
    await expect(uploadPostMedia(opened.db, postId, "aoi", { storage })).rejects.toThrow(/代表者/);
    await expect(uploadPostMedia(opened.db, postId, "system", { storage })).rejects.toThrow(/代表者/);
    expect(storage.calls).toHaveLength(0);
  });

  it("トークン未設定は外部通信前に拒否する", async () => {
    const uploadSpy = vi.fn();
    const storage = mockStorage({ isConfigured: () => false, configurationHelp: () => "トークン未設定のため停止", upload: uploadSpy as never });
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage })).rejects.toThrow(/トークン未設定/);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("export_bundle未生成(approvedのみ)の投稿は拒否する", async () => {
    const other = createPost(opened.db, { pillar: "6", format: "carousel", title: "未書き出し" }, "aoi");
    await expect(uploadPostMedia(opened.db, other.id, "owner", { storage: mockStorage() })).rejects.toThrow(/書き出し済み/);
  });

  it("内容QA未合格は拒否する", async () => {
    opened.db.update(t.qaReviews).set({ result: "fail" }).where(eq(t.qaReviews.postId, postId)).run();
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/QA/);
  });

  it("視覚QA未実施・failは拒否する", async () => {
    const render = latestPostRender(opened.db, postId)!;
    opened.db.update(t.postRenders).set({ visualQaResult: null }).where(eq(t.postRenders.id, render.id)).run();
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/視覚QA/);
    opened.db.update(t.postRenders).set({ visualQaResult: "fail" }).where(eq(t.postRenders.id, render.id)).run();
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/視覚QA/);
  });

  it("design QA failは拒否する", async () => {
    const render = latestPostRender(opened.db, postId)!;
    opened.db.update(t.postRenders).set({ designQaResult: "fail" }).where(eq(t.postRenders.id, render.id)).run();
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/design QA/);
  });

  it("テンプレート版が未承認へ戻ると拒否する", async () => {
    opened.db.update(t.templateVersions).set({ status: "draft" }).where(eq(t.templateVersions.templateId, "tpl-howto")).run();
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/承認されていません/);
  });

  it("画像欠損は拒否する", async () => {
    rmSync(path.join(bundleDir(), "03.png"));
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/不足/);
  });

  it("PNG以外(中身がPNGでないファイル)は拒否する", async () => {
    writeFileSync(path.join(bundleDir(), "02.png"), "これはPNGではない");
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/PNG形式/);
  });

  it("解像度不一致は拒否する", async () => {
    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    writeFileSync(path.join(bundleDir(), "02.png"), small);
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/解像度/);
  });

  it("hash不一致(同解像度の別内容へ差し替え)は拒否する", async () => {
    // 04.pngの内容を01.pngへ差し替え(PNG形式・1080×1350のままhashだけ変わる)
    const other = readFileSync(path.join(bundleDir(), "04.png"));
    writeFileSync(path.join(bundleDir(), "01.png"), other);
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/SHA-256/);
  });

  it("画像枚数不一致(meta改ざん)は拒否する", async () => {
    const metaPath = path.join(bundleDir(), "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { images: string[] };
    meta.images = meta.images.slice(0, 3);
    writeFileSync(metaPath, JSON.stringify(meta));
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() })).rejects.toThrow(/枚数|SHA-256なし/);
  });

  it("ストレージが不正URL(HTTP)を返したら拒否し、DBへ記録しない", async () => {
    const storage = mockStorage({ upload: async () => ({ url: "http://insecure.example.com/a.png" }) });
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage })).rejects.toThrow(/HTTPS/);
    expect(listPostMediaUploads(opened.db, postId)).toHaveLength(0);
  });

  it("アップロード途中失敗ではDBに不完全な記録を残さない", async () => {
    let n = 0;
    const storage = mockStorage({
      upload: async (key: string) => {
        n++;
        if (n === 3) throw new Error("ネットワーク断(モック)");
        return { url: `https://public.example.com/${key}` };
      },
    });
    await expect(uploadPostMedia(opened.db, postId, "owner", { storage })).rejects.toThrow(/ネットワーク断/);
    expect(listPostMediaUploads(opened.db, postId)).toHaveLength(0); // 部分適用なし
    // 再実行(補償方針: content-addressedキーで再収束)
    const ok = await uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() });
    expect(ok.images).toHaveLength(6);
  }, 60_000);

  it("dry-runはMetaへ通信せず、何度実行しても投稿されない(監査へ記録・秘密なし)", async () => {
    await uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() });
    const env = {
      META_PUBLISH_MODE: "disabled",
      META_GRAPH_API_VERSION: "v23.0",
      META_IG_USER_ID: "17841400000000000",
      META_ACCESS_TOKEN: "token-value-EXAMPLE",
    } as NodeJS.ProcessEnv;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r1 = runInstagramDryRun(opened.db, postId, "owner", { env });
    const r2 = runInstagramDryRun(opened.db, postId, "owner", { env });
    expect(fetchSpy).not.toHaveBeenCalled(); // Metaへ一切通信しない
    fetchSpy.mockRestore();
    expect(r1.apiCalled).toBe(false);
    expect(r1.mode).toBe("dry_run");
    expect(r1.plan.imageCount).toBe(6);
    expect(r1.plan.allHttps).toBe(true);
    expect(r1.plan.mediaUrls.every((u) => u.startsWith("https://public.example.com/"))).toBe(true);
    expect(r1.qa.contentQaPass).toBe(true);
    expect(r1.qa.visualQaResult).toBe("pass");
    expect(r1.template?.approved).toBe(true);
    void r2;
    // 投稿状態は変わらない(publishedにならない)
    expect(opened.db.select().from(t.posts).where(eq(t.posts.id, postId)).get()!.status).toBe("exported");
    // 監査記録あり・秘密値なし
    const audits = opened.db.select().from(t.auditLog)
      .where(and(eq(t.auditLog.subjectId, postId), eq(t.auditLog.action, "instagram_dry_run_report"))).all();
    expect(audits.length).toBe(2);
    const allText = JSON.stringify(audits) + JSON.stringify(r1);
    expect(allText).not.toContain("token-value-EXAMPLE");
  }, 60_000);

  it("dry-runもowner専用(actor未指定をowner扱いしない)", async () => {
    await uploadPostMedia(opened.db, postId, "owner", { storage: mockStorage() });
    expect(() => runInstagramDryRun(opened.db, postId, "aoi")).toThrow(/代表者/);
    expect(() => runInstagramDryRun(opened.db, postId, "system")).toThrow(/代表者/);
  });

  it("公開URL未準備かつMETA_MEDIA_BASE_URL未設定ならdry-runは案内つきで拒否する", () => {
    expect(() => runInstagramDryRun(opened.db, postId, "owner", { env: { META_PUBLISH_MODE: "disabled" } as NodeJS.ProcessEnv }))
      .toThrow(/media-upload|META_MEDIA_BASE_URL/);
  });
});
