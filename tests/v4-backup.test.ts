/**
 * V4-E: バックアップ/復旧(AC-30)。すべて一時DB・一時backups・一時workspaceで隔離。
 * 実 data/company.db・data/backups は一切触らない。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@adapters/db/client";
import { ensureSeedOrg, createPost } from "@adapters/db/store";
import * as t from "@adapters/db/schema";
import { doctorScan } from "@adapters/db/views";
import { createBackup, listBackups, restoreBackup } from "@adapters/backup/backup";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v4b-"));
  dbPath = path.join(dir, "company.db");
  process.env.BLOOM_BACKUP_PATH = path.join(dir, "backups");
  process.env.BLOOM_WORKSPACE_PATH = path.join(dir, "workspace");
  mkdirSync(process.env.BLOOM_WORKSPACE_PATH, { recursive: true });
  const { db, sqlite } = openDb(dbPath);
  ensureSeedOrg(db);
  createPost(db, { pillar: "6", format: "carousel", title: "バックアップ対象" }, "aoi");
  sqlite.close();
});
afterEach(() => {
  delete process.env.BLOOM_BACKUP_PATH;
  delete process.env.BLOOM_WORKSPACE_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("V4-E: backup", () => {
  it("整合スナップショット+manifest(SHA-256)を作成し、backup-listで有効と判定される", () => {
    const { dir: bdir, manifest } = createBackup("2026-07-14", { dbPath });
    expect(existsSync(path.join(bdir, "company.db"))).toBe(true);
    expect(existsSync(path.join(bdir, "manifest.json"))).toBe(true);
    expect(manifest.dbSha256).toMatch(/^[0-9a-f]{64}$/);

    const list = listBackups();
    expect(list).toHaveLength(1);
    expect(list[0]!.date).toBe("2026-07-14");
    expect(list[0]!.valid).toBe(true);
    expect(list[0]!.migrations).toBeGreaterThan(0);
  });

  it("同じ日付の再バックアップは冪等(1世代のまま)", () => {
    createBackup("2026-07-14", { dbPath });
    createBackup("2026-07-14", { dbPath });
    expect(listBackups()).toHaveLength(1);
  });

  it("不正な日付・パスを拒否し、既存ファイルを削除しない", () => {
    const victim = path.join(dir, "victim");
    mkdirSync(victim);
    writeFileSync(path.join(victim, "keep.txt"), "keep");
    expect(() => createBackup("../victim", { dbPath })).toThrow(/YYYY-MM-DD/);
    expect(existsSync(path.join(victim, "keep.txt"))).toBe(true);
    expect(() => restoreBackup("../../victim", { dbPath })).toThrow(/復元元/);
  });

  it("同日バックアップの作り直しに失敗しても直前の成功世代を保持する", () => {
    createBackup("2026-07-14", { dbPath });
    const invalidDb = path.join(dir, "invalid.db");
    writeFileSync(invalidDb, "SQLiteではない");
    expect(() => createBackup("2026-07-14", { dbPath: invalidDb })).toThrow();
    const list = listBackups();
    expect(list.find((b) => b.date === "2026-07-14")?.valid).toBe(true);
  });
});

describe("V4-E: restore", () => {
  it("checksum不一致(改ざん)の復元は拒否され、現DBは無傷", () => {
    createBackup("2026-07-14", { dbPath });
    // バックアップの company.db を改ざん(manifestのsha256と不一致にする)
    const backupDb = path.join(process.env.BLOOM_BACKUP_PATH!, "2026-07-14", "company.db");
    const buf = readFileSync(backupDb);
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
    writeFileSync(backupDb, buf);

    // 現DBの投稿を1件追加(復元が成功したら消えるはず → 無傷なら残る)
    let opened = openDb(dbPath);
    createPost(opened.db, { pillar: "3", format: "carousel", title: "復元後も残る" }, "aoi");
    opened.sqlite.close();

    expect(() =>
      restoreBackup("2026-07-14", { dbPath, verify: (d) => doctorScan(d) }),
    ).toThrow(/SHA-256|改ざん|破損/);

    opened = openDb(dbPath);
    const titles = opened.db.select().from(t.posts).all().map((p) => p.title);
    opened.sqlite.close();
    expect(titles).toContain("復元後も残る");
  });

  it("正常な復元は成功し、バックアップ時点の状態へ戻る(復元前バックアップも作成)", () => {
    // T0: 投稿1件の状態をバックアップ
    writeFileSync(path.join(process.env.BLOOM_WORKSPACE_PATH!, "before.txt"), "before");
    createBackup("2026-07-14", { dbPath });

    // T1: 投稿を追加(この変更は復元で消える)
    let opened = openDb(dbPath);
    createPost(opened.db, { pillar: "3", format: "carousel", title: "復元で消える" }, "aoi");
    const before = opened.db.select().from(t.posts).all().length;
    opened.sqlite.close();
    expect(before).toBe(2);
    writeFileSync(path.join(process.env.BLOOM_WORKSPACE_PATH!, "before.txt"), "after");

    const result = restoreBackup("2026-07-14", { dbPath, verify: (d) => doctorScan(d) });
    expect(result.restoredFrom).toBe("2026-07-14");
    expect(result.preRestoreBackup).toBeTruthy(); // 復元前バックアップが作られている

    opened = openDb(dbPath);
    const titles = opened.db.select().from(t.posts).all().map((p) => p.title);
    opened.sqlite.close();
    expect(titles).toEqual(["バックアップ対象"]);
    expect(titles).not.toContain("復元で消える");
    expect(readFileSync(path.join(process.env.BLOOM_WORKSPACE_PATH!, "before.txt"), "utf8")).toBe("before");
    expect(result.workspaceRestored).toBe(true);
  });

  it("workspaceファイルのchecksum不一致も復元を拒否する", () => {
    writeFileSync(path.join(process.env.BLOOM_WORKSPACE_PATH!, "asset.txt"), "original");
    createBackup("2026-07-14", { dbPath });
    const backupAsset = path.join(process.env.BLOOM_BACKUP_PATH!, "2026-07-14", "workspace", "asset.txt");
    writeFileSync(backupAsset, "tampered");
    expect(() => restoreBackup("2026-07-14", { dbPath })).toThrow(/SHA-256|改ざん|破損/);
  });

  it("バックアップ時にworkspaceが存在しなければ、その不在状態まで復元する", () => {
    rmSync(process.env.BLOOM_WORKSPACE_PATH!, { recursive: true, force: true });
    createBackup("2026-07-14", { dbPath });

    mkdirSync(process.env.BLOOM_WORKSPACE_PATH!, { recursive: true });
    writeFileSync(path.join(process.env.BLOOM_WORKSPACE_PATH!, "later.txt"), "later");
    const result = restoreBackup("2026-07-14", { dbPath, verify: (d) => doctorScan(d) });

    expect(result.workspaceRestored).toBe(true);
    expect(existsSync(process.env.BLOOM_WORKSPACE_PATH!)).toBe(false);
  });

  it("存在しない日付の復元はエラーで中止(現DB無傷)", () => {
    let opened = openDb(dbPath);
    const countBefore = opened.db.select().from(t.posts).all().length;
    opened.sqlite.close();

    expect(() => restoreBackup("2000-01-01", { dbPath })).toThrow(/見つかりません/);

    opened = openDb(dbPath);
    expect(opened.db.select().from(t.posts).all().length).toBe(countBefore);
    opened.sqlite.close();
  });
});
