/**
 * V5.4: クラウド対応基盤のテスト。
 * すべて一時DB・一時ディレクトリで実行し、実DB・実backups・外部サービスへは一切触れない。
 * PostgreSQL・Vercel・Blob・Metaへの実通信はゼロ(接続実装が無いことも検証対象)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, renameSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb } from "@adapters/db/client";
import * as t from "@adapters/db/schema";
import { ensureSeedOrg, createPost } from "@adapters/db/store";
import { resolveDatabaseProvider, assertDatabaseProviderUsable } from "@adapters/db/provider";
import { runDbExport, verifyDbExport, EXPORT_TABLES, DB_EXPORT_VERSION } from "@adapters/db/migrate/export";
import { checkImportSource, runPostgresImport } from "@adapters/db/migrate/import-check";
import { buildCloudReadiness, postgresSchemaPrepared } from "@adapters/cloud/readiness";
import { loadInstagramConfig, assertInstagramLiveConfig } from "@adapters/instagram/config";
import { publishInstagramPost } from "@adapters/instagram/publish";
import {
  liveInstagramBlockedReason,
  cloudMutationBlockedReason,
  resolveRuntimeMode,
} from "@core/runtime";
import { assertOwnerRequest, OWNER_ACTION_HEADER, OWNER_ACTION_VALUE } from "../apps/dashboard/lib/owner-request";
import { findRepoRoot } from "@adapters/root";
import Database from "better-sqlite3";

let dir: string;
let dbPath: string;

function seedDb(): void {
  const { db, sqlite } = openDb(dbPath);
  ensureSeedOrg(db);
  createPost(db, { pillar: "6", format: "carousel", title: "V5.4移行テスト投稿" }, "aoi");
  sqlite.close();
}

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

interface ManifestJson {
  totalRows: number;
  schemaVersion: number;
  tables: { name: string; file: string; rows: number; sha256: string; bytes: number }[];
}

function readManifest(outDir: string): ManifestJson {
  return JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf8")) as ManifestJson;
}

function writeManifest(outDir: string, m: ManifestJson): void {
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(m, null, 2) + "\n", "utf8");
}

/** テスト用: JSONLを差し替えた後にmanifestのsha256/bytes/rows/totalRowsを整合させる(検証対象を限定するため) */
function rewriteManifestEntry(outDir: string, table: string, body: string, addedRows: number): void {
  const m = readManifest(outDir);
  const entry = m.tables.find((x) => x.name === table)!;
  entry.sha256 = createHash("sha256").update(body).digest("hex");
  entry.bytes = Buffer.byteLength(body);
  entry.rows += addedRows;
  m.totalRows += addedRows;
  writeManifest(outDir, m);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-v54-"));
  dbPath = path.join(dir, "company.db");
  process.env.BLOOM_DB_PATH = dbPath;
  process.env.BLOOM_BACKUP_PATH = path.join(dir, "backups");
  process.env.BLOOM_WORKSPACE_PATH = path.join(dir, "workspace");
  mkdirSync(process.env.BLOOM_WORKSPACE_PATH, { recursive: true });
  seedDb();
});
afterEach(() => {
  delete process.env.BLOOM_DB_PATH;
  delete process.env.BLOOM_BACKUP_PATH;
  delete process.env.BLOOM_WORKSPACE_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("V5.4 DBプロバイダー境界", () => {
  it("既定はsqlite(未設定・空文字)", () => {
    expect(resolveDatabaseProvider({}).provider).toBe("sqlite");
    expect(resolveDatabaseProvider({ DATABASE_PROVIDER: "" }).provider).toBe("sqlite");
    expect(resolveDatabaseProvider({ DATABASE_PROVIDER: "sqlite" }).provider).toBe("sqlite");
  });

  it("postgres指定でDATABASE_URLが無ければfail closed(値はエラーへ含めない)", () => {
    expect(() => resolveDatabaseProvider({ DATABASE_PROVIDER: "postgres" })).toThrow(/DATABASE_URL が未設定/);
    expect(() => resolveDatabaseProvider({ DATABASE_PROVIDER: "mysql" })).toThrow(/sqlite \/ postgres/);
  });

  it("postgres+URLありでも、V5.4では接続未実装として正直に停止する(偽装しない)", () => {
    const env = { DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://EXAMPLE-not-real/db" };
    expect(resolveDatabaseProvider(env).databaseUrlConfigured).toBe(true);
    let message = "";
    try {
      assertDatabaseProviderUsable(env);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/未実装/);
    expect(message).not.toContain("EXAMPLE-not-real"); // 接続文字列を漏らさない
  });

  it("openDbはDATABASE_PROVIDER=postgresのとき開かない(SQLite実運用の保護)", () => {
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = "postgres://EXAMPLE-not-real/db";
    try {
      expect(() => openDb(dbPath)).toThrow(/未実装/);
    } finally {
      delete process.env.DATABASE_PROVIDER;
      delete process.env.DATABASE_URL;
    }
  });
});

describe("V5.4 db-export", () => {
  it("owner以外は拒否する(systemの自動昇格なし)", () => {
    expect(() => runDbExport("system")).toThrow(/owner/);
    expect(() => runDbExport("aoi")).toThrow(/owner/);
  });

  it("全対象テーブルをJSONL+manifestで書き出し、実DBを一切変更しない", () => {
    const before = sha256File(dbPath);
    const beforeMtime = statSync(dbPath).mtimeMs;
    const { outDir, manifest } = runDbExport("owner");
    expect(sha256File(dbPath)).toBe(before);
    expect(statSync(dbPath).mtimeMs).toBe(beforeMtime);
    expect(manifest.exportVersion).toBe(DB_EXPORT_VERSION);
    expect(manifest.tables.map((tb) => tb.name).sort()).toEqual(EXPORT_TABLES.map((s) => s.name).sort());
    // 件数がDBと一致する(データ保持)
    const raw = new Database(dbPath, { readonly: true });
    try {
      for (const tb of manifest.tables) {
        const n = (raw.prepare(`select count(*) n from "${tb.name}"`).get() as { n: number }).n;
        expect(tb.rows, tb.name).toBe(n);
      }
    } finally {
      raw.close();
    }
    // append-onlyイベントもそのまま含まれる
    const eventsFile = readFileSync(path.join(outDir, "task_events.jsonl"), "utf8");
    const opened = openDb(dbPath);
    const eventCount = opened.db.select().from(t.taskEvents).all().length;
    opened.sqlite.close();
    expect(eventsFile.split("\n").filter(Boolean).length).toBe(eventCount);
    // manifestに絶対パス・秘密値を含めない
    const manifestText = readFileSync(path.join(outDir, "manifest.json"), "utf8");
    expect(manifestText).not.toContain(dir);
    // 検証が通る
    const verify = verifyDbExport(outDir);
    expect(verify.ok).toBe(true);
    expect(verify.problems).toEqual([]);
  });

  it("同じDB状態からのエクスポートはテーブル内容が同一(決定的)", () => {
    const a = runDbExport("owner", { outDir: path.join(dir, "exp-a") });
    const b = runDbExport("owner", { outDir: path.join(dir, "exp-b") });
    for (const tb of a.manifest.tables) {
      const other = b.manifest.tables.find((x) => x.name === tb.name)!;
      expect(other.sha256, tb.name).toBe(tb.sha256);
    }
  });

  it("SHA-256改ざん・欠損・件数不一致を検知する", () => {
    const { outDir } = runDbExport("owner");
    // 改ざん
    const target = path.join(outDir, "posts.jsonl");
    writeFileSync(target, readFileSync(target, "utf8").replace("V5.4移行テスト投稿", "改ざんタイトル"), "utf8");
    const tampered = verifyDbExport(outDir);
    expect(tampered.ok).toBe(false);
    expect(tampered.problems.join(" ")).toMatch(/SHA-256/);
    // 欠損(manifestなし)
    rmSync(path.join(outDir, "manifest.json"));
    expect(verifyDbExport(outDir).problems.join(" ")).toMatch(/manifest/);
  });

  it("出力途中の失敗で不完全な正式成果物を残さない(tmpのみ・atomic rename)", () => {
    // 既存ディレクトリへの上書きを拒否する=中途半端な状態を作らない
    const outDir = path.join(dir, "exp-fixed");
    runDbExport("owner", { outDir });
    expect(() => runDbExport("owner", { outDir })).toThrow(/既に存在/);
    // tmpディレクトリが残っていない
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });
});

describe("V5.4 db-import-check / db-import-postgres", () => {
  it("正常なエクスポートはimport順・件数を提示して合格する", () => {
    const { outDir } = runDbExport("owner");
    const report = checkImportSource(outDir);
    expect(report.ok).toBe(true);
    expect(report.importOrder[0]).toBe("schema_migrations");
    expect(report.importOrder).toContain("post_media_uploads");
    expect(report.totalRows).toBeGreaterThan(0);
    expect(report.transactionPlan).toMatch(/1つのトランザクション/);
    expect(report.idempotencyPlan).toMatch(/二重import/);
  });

  it("FK不整合のエクスポートを拒否する", () => {
    const { outDir } = runDbExport("owner");
    // tasksへ存在しないemployeeを参照する行を注入し、SHA-256/bytes/totalRowsもmanifest側を合わせて更新
    //(改ざん検知ではなくFK検知そのものを検証するため)
    const tasksPath = path.join(outDir, "tasks.jsonl");
    const orphan = JSON.stringify({ id: "task_orphan", idempotency_key: "k-orphan", type: "qa", title: "孤立", assignee_id: "emp_missing", post_id: null, status: "queued", priority: 5, input_json: null, retry_count: 0, run_date: "2026-07-17", error: null, created_at: "2026-07-17T00:00:00.000Z", started_at: null, finished_at: null });
    const body = readFileSync(tasksPath, "utf8") + orphan + "\n";
    writeFileSync(tasksPath, body, "utf8");
    rewriteManifestEntry(outDir, "tasks", body, 1);
    const report = checkImportSource(outDir);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/FK不整合.*employees/);
  });

  it("重複主キーを拒否する", () => {
    const { outDir } = runDbExport("owner");
    const postsPath = path.join(outDir, "posts.jsonl");
    const lines = readFileSync(postsPath, "utf8").split("\n").filter(Boolean);
    const body = [...lines, lines[0]!].join("\n") + "\n";
    writeFileSync(postsPath, body, "utf8");
    rewriteManifestEntry(outDir, "posts", body, 1);
    const report = checkImportSource(outDir);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/重複主キー/);
  });

  it("schema version不一致を拒否する", () => {
    const { outDir } = runDbExport("owner");
    const mPath = path.join(outDir, "manifest.json");
    const m = JSON.parse(readFileSync(mPath, "utf8")) as { schemaVersion: number };
    m.schemaVersion = 1;
    writeFileSync(mPath, JSON.stringify(m, null, 2) + "\n", "utf8");
    const report = checkImportSource(outDir);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/schema version/);
  });

  it("importは既定dry-run。--executeでもprovider/URLが無ければ拒否、揃っていても未実装として接続前に停止する", () => {
    const { outDir } = runDbExport("owner");
    expect(() => runPostgresImport(outDir, "aoi")).toThrow(/owner/);
    const dry = runPostgresImport(outDir, "owner");
    expect(dry.executed).toBe(false);
    expect(dry.dryRun).toBe(true);
    expect(dry.ok).toBe(true);
    // executeでも環境なしは拒否(fail closed)
    expect(() => runPostgresImport(outDir, "owner", { execute: true, env: {} })).toThrow(/DATABASE_PROVIDER=postgres/);
    expect(() => runPostgresImport(outDir, "owner", { execute: true, env: { DATABASE_PROVIDER: "postgres" } })).toThrow(/DATABASE_URL/);
    // 環境が揃っても、実装が無い間は「成功した」と偽らない
    expect(() =>
      runPostgresImport(outDir, "owner", {
        execute: true,
        env: { DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://EXAMPLE-not-real/db" },
      }),
    ).toThrow(/未実装/);
  });
});

describe("V5.4 PostgreSQLスキーマ準備", () => {
  it("schema.sqlに全対象テーブルのCREATE TABLEが存在する", () => {
    const { prepared, missingTables } = postgresSchemaPrepared();
    expect(missingTables).toEqual([]);
    expect(prepared).toBe(true);
  });

  it("SQLite実スキーマの全列がschema.sqlに存在する(機械照合)", () => {
    const sqlText = readFileSync(
      path.join(findRepoRoot(), "src", "adapters", "db", "postgres", "schema.sql"),
      "utf8",
    );
    const raw = new Database(dbPath, { readonly: true });
    try {
      for (const spec of EXPORT_TABLES) {
        const block = sqlText.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${spec.name}\\s*\\(([\\s\\S]*?)\\n\\);`));
        expect(block, `schema.sqlに ${spec.name} がない`).toBeTruthy();
        const pgColumns = new Set(
          block![1]!
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("--") && !/^(PRIMARY KEY|UNIQUE\s|CHECK\s*\(|FOREIGN KEY|CONSTRAINT\s)/i.test(l))
            .map((l) => l.split(/\s+/)[0]!.replace(/"/g, "")),
        );
        const cols = raw.pragma(`table_info(${spec.name})`) as { name: string }[];
        for (const col of cols) {
          expect(pgColumns.has(col.name), `${spec.name}.${col.name} がschema.sqlにない`).toBe(true);
        }
      }
    } finally {
      raw.close();
    }
  });
});

describe("V5.4 Instagram live環境ゲート", () => {
  const LIVE_BASE = {
    META_PUBLISH_MODE: "live",
    META_IG_USER_ID: "17840000000000000",
    META_ACCESS_TOKEN: "token-value-EXAMPLE",
    META_MEDIA_BASE_URL: "https://media.example.com/bloom",
  };

  it("Vercel Previewではliveが構造的に拒否される(ALLOW_LIVEでも解除不可)", () => {
    const env = { ...LIVE_BASE, VERCEL_ENV: "preview", ALLOW_LIVE_INSTAGRAM_PUBLISH: "true" };
    expect(liveInstagramBlockedReason(env)).toMatch(/Preview/);
    const config = loadInstagramConfig(env);
    expect(config.mode).toBe("disabled");
    expect(config.requestedMode).toBe("live");
    expect(config.liveBlockedReason).toMatch(/Preview/);
  });

  it("テスト環境(NODE_ENV=test)ではliveを有効化できない", () => {
    expect(liveInstagramBlockedReason({ ...LIVE_BASE, NODE_ENV: "test" })).toMatch(/テスト環境/);
    expect(loadInstagramConfig({ ...LIVE_BASE, NODE_ENV: "test" }).mode).toBe("disabled");
  });

  it("Vercel productionでもALLOW_LIVE_INSTAGRAM_PUBLISH=trueが無ければ拒否する(二重条件)", () => {
    expect(liveInstagramBlockedReason({ ...LIVE_BASE, VERCEL_ENV: "production" })).toMatch(/ALLOW_LIVE_INSTAGRAM_PUBLISH/);
    expect(loadInstagramConfig({ ...LIVE_BASE, VERCEL_ENV: "production" }).mode).toBe("disabled");
    // 二重条件が揃えばliveのまま(公開経路の他ゲートは別途適用される)
    expect(liveInstagramBlockedReason({ ...LIVE_BASE, VERCEL_ENV: "production", ALLOW_LIVE_INSTAGRAM_PUBLISH: "true" })).toBeNull();
  });

  it("ローカル代表者環境(VERCEL_ENVなし)は従来どおりliveを維持する(V5.3手順を壊さない)", () => {
    expect(liveInstagramBlockedReason(LIVE_BASE)).toBeNull();
    expect(loadInstagramConfig(LIVE_BASE).mode).toBe("live");
  });

  it("Preview相当環境でpublishInstagramPostを呼んでも外部送信前に拒否される", async () => {
    const opened = openDb(dbPath);
    try {
      const post = opened.db.select().from(t.posts).get()!;
      const client = { publish: async () => { throw new Error("呼ばれてはならない"); } };
      await expect(
        publishInstagramPost(opened.db, post.id, "owner", {
          env: { ...LIVE_BASE, VERCEL_ENV: "preview" } as NodeJS.ProcessEnv,
          client,
        }),
      ).rejects.toThrow(/Preview/);
    } finally {
      opened.sqlite.close();
    }
  });
});

describe("V5.4 クラウド認証ガード", () => {
  function ownerHeaders(): Record<string, string> {
    return {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "sec-fetch-site": "same-origin",
      [OWNER_ACTION_HEADER]: OWNER_ACTION_VALUE,
    };
  }

  it("既定(local)は従来どおり通る", () => {
    expect(resolveRuntimeMode({})).toBe("local");
    expect(cloudMutationBlockedReason({})).toBeNull();
    const req = new Request("http://localhost:3000/api/test", { method: "POST", headers: ownerHeaders() });
    expect(() => assertOwnerRequest(req, {})).not.toThrow();
  });

  it("cloudモードで認証未設定なら、正しいヘッダーでも変更操作を拒否する(fail closed)", () => {
    const req = new Request("http://localhost:3000/api/test", { method: "POST", headers: ownerHeaders() });
    expect(() => assertOwnerRequest(req, { APP_RUNTIME_MODE: "cloud" })).toThrow(/認証が未設定/);
    expect(() => assertOwnerRequest(req, { VERCEL_ENV: "preview" })).toThrow(/認証が未設定/);
    // 未実装providerを設定しても通らない(実装済みの方式だけが有効)
    expect(() => assertOwnerRequest(req, { APP_RUNTIME_MODE: "cloud", OWNER_AUTH_PROVIDER: "basic" })).toThrow(/未実装/);
  });
});

describe("V5.4 cloud-readiness", () => {
  it("ローカル既定構成: sqliteReady・previewSafe・秘密値なし", () => {
    const secret = "postgres://user:SECRET-EXAMPLE@host/db";
    const report = buildCloudReadiness(
      { DATABASE_URL: secret, BLOB_READ_WRITE_TOKEN: "blob-token-value-EXAMPLE" },
      { sqliteQueryOk: true, blobConfigured: true, backupCount: 1 },
    );
    expect(report.ok).toBe(true);
    expect(report.runtimeMode).toBe("local");
    expect(report.databaseProvider).toBe("sqlite");
    expect(report.sqliteReady).toBe(true);
    expect(report.postgresPrepared).toBe(true);
    expect(report.postgresConnected).toBe(false);
    expect(report.instagramLiveBlockedInPreview).toBe(true);
    expect(report.vercelDeployReady).toBe(false);
    const text = JSON.stringify(report);
    expect(text).not.toContain("SECRET-EXAMPLE");
    expect(text).not.toContain("blob-token-value-EXAMPLE");
  });

  it("cloud実行はSQLite使用と認証未設定をblockerとして報告する", () => {
    const report = buildCloudReadiness(
      { VERCEL_ENV: "preview" },
      { sqliteQueryOk: true, blobConfigured: false, backupCount: 0 },
    );
    expect(report.ok).toBe(false);
    expect(report.runtimeMode).toBe("cloud");
    expect(report.blockers.join(" ")).toMatch(/SQLite.*Vercelでは使用できません/);
    expect(report.blockers.join(" ")).toMatch(/owner認証が未設定/);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("postgres指定+URLなしはblockerになる(例外で落ちない)", () => {
    const report = buildCloudReadiness(
      { DATABASE_PROVIDER: "postgres" },
      { sqliteQueryOk: true, blobConfigured: false, backupCount: 0 },
    );
    expect(report.ok).toBe(false);
    expect(report.databaseProvider).toBe("invalid");
    expect(report.blockers.join(" ")).toMatch(/DATABASE_URL/);
  });
});

describe("V5.4レビュー修正2: 攻撃的manifestのfail closed検証", () => {
  it("パストラバーサル(../../.env)・絶対パスのfileを拒否し、ファイル内容を読まない", () => {
    const { outDir } = runDbExport("owner");
    const m = readManifest(outDir);
    m.tables.find((x) => x.name === "posts")!.file = "../../.env";
    m.tables.find((x) => x.name === "tasks")!.file = "/etc/hosts";
    writeManifest(outDir, m);
    const report = verifyDbExport(outDir);
    expect(report.ok).toBe(false);
    const joined = report.problems.join(" ");
    expect(joined).toMatch(/規約.*posts/);
    expect(joined).toMatch(/規約.*tasks/);
    // 攻撃対象ファイルの内容(秘密値)が出力へ流れていない
    expect(JSON.stringify(report)).not.toMatch(/META_ACCESS_TOKEN|BLOB_READ_WRITE|localhost/);
  });

  it("重複テーブル・重複file・未知テーブルを拒否する", () => {
    const { outDir } = runDbExport("owner");
    const m = readManifest(outDir);
    const posts = m.tables.find((x) => x.name === "posts")!;
    m.tables.push({ ...posts }); // 重複テーブル+重複file
    m.tables.push({ name: "evil_table", file: "evil_table.jsonl", rows: 0, sha256: "0".repeat(64), bytes: 0 });
    writeManifest(outDir, m);
    const report = verifyDbExport(outDir);
    expect(report.ok).toBe(false);
    const joined = report.problems.join(" ");
    expect(joined).toMatch(/テーブル posts が重複/);
    expect(joined).toMatch(/ファイル名が重複/);
    expect(joined).toMatch(/未知のテーブル.*evil_table/);
  });

  it("bytes改ざん・totalRows不一致・スキーマ違反(未知キー/不正sha256)を拒否する", () => {
    const { outDir } = runDbExport("owner");
    // bytesのみ改ざん
    const m1 = readManifest(outDir);
    m1.tables.find((x) => x.name === "posts")!.bytes += 7;
    writeManifest(outDir, m1);
    expect(verifyDbExport(outDir).problems.join(" ")).toMatch(/ファイルサイズが一致しません/);
    // totalRows改ざん
    const m2 = readManifest(outDir);
    m2.tables.find((x) => x.name === "posts")!.bytes -= 7;
    m2.totalRows += 5;
    writeManifest(outDir, m2);
    expect(verifyDbExport(outDir).problems.join(" ")).toMatch(/totalRowsが一致しません/);
    // スキーマ違反: 未知キーと不正sha256
    const m3 = readManifest(outDir) as ManifestJson & { evil?: string };
    m3.totalRows -= 5;
    m3.evil = "x";
    m3.tables[0]!.sha256 = "not-a-hash";
    writeManifest(outDir, m3);
    const report = verifyDbExport(outDir);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/スキーマ検証に失敗/);
  });

  it("主キー欠落(null/未定義)行とシンボリックリンク・manifest外ファイルを拒否する", () => {
    const { outDir } = runDbExport("owner");
    // 主キー欠落行を注入
    const postsPath = path.join(outDir, "posts.jsonl");
    const body = readFileSync(postsPath, "utf8") + JSON.stringify({ id: null, title: "PKなし" }) + "\n";
    writeFileSync(postsPath, body, "utf8");
    rewriteManifestEntry(outDir, "posts", body, 1);
    let report = verifyDbExport(outDir);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/主キー列が欠落/);
    // シンボリックリンク差し替え
    const { outDir: outDir2 } = runDbExport("owner", { outDir: path.join(dir, "exp-symlink") });
    renameSync(path.join(outDir2, "posts.jsonl"), path.join(outDir2, "posts-real.bak"));
    symlinkSync(path.join(outDir2, "posts-real.bak"), path.join(outDir2, "posts.jsonl"));
    report = verifyDbExport(outDir2);
    expect(report.ok).toBe(false);
    expect(report.problems.join(" ")).toMatch(/シンボリックリンク/);
    expect(report.problems.join(" ")).toMatch(/manifestに記載のないファイル/); // posts-real.bak の混入も拒否
  });
});

describe("V5.4レビュー修正3: exportの単一スナップショット", () => {
  it("export中に別接続から書き込まれても、export内容は開始時点のスナップショットになる", () => {
    const before = openDb(dbPath);
    const postCountBefore = before.db.select().from(t.posts).all().length;
    before.sqlite.close();

    let injected = false;
    const { outDir, manifest } = runDbExport("owner", {
      outDir: path.join(dir, "exp-snapshot"),
      onTableExported: (name) => {
        // 最初のテーブル書き出し直後(=スナップショット確定後)に別接続で投稿を追加する
        if (name === "schema_migrations" && !injected) {
          injected = true;
          const writer = openDb(dbPath);
          createPost(writer.db, { pillar: "6", format: "carousel", title: "export中に追加された投稿" }, "aoi");
          writer.sqlite.close();
        }
      },
    });
    expect(injected).toBe(true);
    // exportには並行書き込みが含まれない(単一時点)
    const postsBody = readFileSync(path.join(outDir, "posts.jsonl"), "utf8");
    expect(postsBody).not.toContain("export中に追加された投稿");
    expect(manifest.tables.find((x) => x.name === "posts")!.rows).toBe(postCountBefore);
    expect(verifyDbExport(outDir).ok).toBe(true);
    // DB自体には書き込みが反映されている(exportが書き込みをブロック・破壊していない)
    const after = openDb(dbPath);
    const titles = after.db.select().from(t.posts).all().map((p) => p.title);
    after.sqlite.close();
    expect(titles).toContain("export中に追加された投稿");
  });
});

describe("V5.4レビュー修正4: import_history設計整合", () => {
  it("schema.sqlにimport_history(import_id主キー)があり、SQLite export対象には含まれない", () => {
    const sqlText = readFileSync(path.join(findRepoRoot(), "src", "adapters", "db", "postgres", "schema.sql"), "utf8");
    const block = sqlText.match(/CREATE TABLE IF NOT EXISTS import_history\s*\(([\s\S]*?)\n\);/);
    expect(block).toBeTruthy();
    expect(block![1]).toMatch(/import_id text PRIMARY KEY/);
    expect(block![1]).toMatch(/manifest_digest text NOT NULL UNIQUE/);
    expect(block![1]).toMatch(/schema_version integer NOT NULL/);
    expect(block![1]).toMatch(/total_rows integer NOT NULL/);
    expect(block![1]).toMatch(/imported_at timestamptz NOT NULL/);
    expect(EXPORT_TABLES.some((x) => x.name === "import_history")).toBe(false);
    // import-checkの説明もimport_history方式を明示している
    const { outDir } = runDbExport("owner", { outDir: path.join(dir, "exp-ih") });
    expect(checkImportSource(outDir).idempotencyPlan).toMatch(/import_history/);
  });
});

describe("V5.4レビュー修正5: Instagram envの依存注入統一", () => {
  const LIVE_BASE = {
    META_PUBLISH_MODE: "live",
    META_IG_USER_ID: "17840000000000000",
    META_ACCESS_TOKEN: "token-value-EXAMPLE",
    META_MEDIA_BASE_URL: "https://media.example.com/bloom",
  };

  it("assertInstagramLiveConfigは渡したenvだけを検証し、process.envの汚染に影響されない", () => {
    const original = process.env.META_PUBLISH_MODE;
    process.env.META_PUBLISH_MODE = "bogus-mode";
    try {
      const config = loadInstagramConfig(LIVE_BASE);
      // 注入envでは合格
      expect(() => assertInstagramLiveConfig(config, { deferMediaCheckToPostPlan: true }, LIVE_BASE)).not.toThrow();
      // 既定(process.env)は汚染を検出する=envが実際に効いている
      expect(() => assertInstagramLiveConfig(config, { deferMediaCheckToPostPlan: true })).toThrow(/META_PUBLISH_MODE/);
    } finally {
      if (original === undefined) delete process.env.META_PUBLISH_MODE;
      else process.env.META_PUBLISH_MODE = original;
    }
  });

  it("publishInstagramPostはdeps.envで一貫検証する(process.env汚染下でも設定エラーにならない)", async () => {
    const original = process.env.META_PUBLISH_MODE;
    process.env.META_PUBLISH_MODE = "bogus-mode";
    const opened = openDb(dbPath);
    try {
      const post = opened.db.select().from(t.posts).get()!;
      const client = { publish: async () => { throw new Error("呼ばれてはならない"); } };
      // 設定検証(deps.env)は通過し、次の実投稿ゲート(二段階確認)で止まる
      await expect(
        publishInstagramPost(opened.db, post.id, "owner", { env: LIVE_BASE as NodeJS.ProcessEnv, client }),
      ).rejects.toThrow(/二段階確認/);
    } finally {
      opened.sqlite.close();
      if (original === undefined) delete process.env.META_PUBLISH_MODE;
      else process.env.META_PUBLISH_MODE = original;
    }
  });
});

describe("V5.4レビュー修正1: CLIのDB遅延初期化(子プロセス回帰)", () => {
  const repoRoot = findRepoRoot();
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

  function runCli(cliArgs: string[], extraEnv: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(tsxBin, ["scripts/company.ts", ...cliArgs], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        BLOOM_DB_PATH: dbPath,
        BLOOM_BACKUP_PATH: path.join(dir, "backups"),
        BLOOM_WORKSPACE_PATH: path.join(dir, "workspace"),
        ...extraEnv,
      },
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  it("DATABASE_PROVIDER=postgres + DATABASE_URLありでもcloud-readinessが診断JSONを返す", () => {
    const r = runCli(["cloud-readiness"], {
      DATABASE_PROVIDER: "postgres",
      DATABASE_URL: "postgres://user:PASS-EXAMPLE@db.example.internal/bloom",
    });
    const report = JSON.parse(r.stdout) as { ok: boolean; databaseProvider: string; sqliteReady: boolean; blockers: string[] };
    expect(report.databaseProvider).toBe("postgres");
    expect(report.sqliteReady).toBe(false);
    expect(report.ok).toBe(false); // postgres未実装のblockerを正直に報告(診断は完走)
    expect(report.blockers.join(" ")).toMatch(/未実装/);
    expect(r.status).toBe(1);
    // 接続文字列(秘密値)を出力しない
    expect(r.stdout + r.stderr).not.toContain("PASS-EXAMPLE");
  }, 60_000);

  it("db-import-postgres --executeは外部接続せずrunPostgresImport内の「未実装」で停止する", () => {
    const { outDir } = runDbExport("owner", { outDir: path.join(dir, "exp-cli") });
    const r = runCli(["db-import-postgres", "--from", outDir, "--actor", "owner", "--execute"], {
      DATABASE_PROVIDER: "postgres",
      DATABASE_URL: "postgres://user:PASS-EXAMPLE@db.example.internal/bloom",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/未実装/); // openDbのprovider停止ではなく、import境界の停止に到達している
    expect(r.stderr).not.toMatch(/DATABASE_PROVIDER=postgres ですが/);
    expect(r.stdout + r.stderr).not.toContain("PASS-EXAMPLE");
  }, 60_000);

  it("db-export-verifyもprovider=postgres設定下で動作する(遅延初期化)", () => {
    const { outDir } = runDbExport("owner", { outDir: path.join(dir, "exp-cli-verify") });
    const r = runCli(["db-export-verify", "--from", outDir], {
      DATABASE_PROVIDER: "postgres",
      DATABASE_URL: "postgres://user:PASS-EXAMPLE@db.example.internal/bloom",
    });
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { ok: boolean }).ok).toBe(true);
  }, 60_000);

  it("通常のSQLiteローカル運用(status)は従来どおり動作する", () => {
    const r = runCli(["status"], {});
    expect(r.status).toBe(0);
    const state = JSON.parse(r.stdout) as { counts?: unknown };
    expect(state).toHaveProperty("counts");
  }, 60_000);
});

describe("V5.4レビュー修正1b: cloud-readiness単体(postgres+URL)", () => {
  it("postgres+URLはblockerに「未実装」を含み、URL値を出力しない", () => {
    const report = buildCloudReadiness(
      { DATABASE_PROVIDER: "postgres", DATABASE_URL: "postgres://user:SECRET-EXAMPLE@host/db" },
      { sqliteQueryOk: false, blobConfigured: false, backupCount: 0 },
    );
    expect(report.ok).toBe(false);
    expect(report.databaseProvider).toBe("postgres");
    expect(report.blockers.join(" ")).toMatch(/未実装/);
    expect(JSON.stringify(report)).not.toContain("SECRET-EXAMPLE");
  });
});
