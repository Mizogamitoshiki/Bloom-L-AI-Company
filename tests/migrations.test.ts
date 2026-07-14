/**
 * V3レビュー指摘3: バージョン付きマイグレーションのテスト。
 * 空DB / V2形式DB / 再実行 / 途中失敗ロールバック / データ保持 / FK・重複拒否 / PRAGMA検証。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { openDb, BASE_DDL } from "@adapters/db/client";
import * as schema from "@adapters/db/schema";
import { runMigrations, MIGRATIONS, MigrationError, type Migration } from "@adapters/db/migrations";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bloom-mig-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** V2形式(マイグレーション未適用)のDBを作る */
function makeV2Db(file: string): Database.Database {
  const sqlite = new Database(path.join(dir, file));
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(BASE_DDL);
  return sqlite;
}

function fkList(sqlite: Database.Database, table: string): { table: string; from: string }[] {
  return sqlite.pragma(`foreign_key_list(${table})`) as { table: string; from: string }[];
}

describe("マイグレーション", () => {
  it("空DBへのmigration: schema_migrationsに全件記録され、FK・インデックスが揃う", () => {
    const { sqlite } = openDb(path.join(dir, "fresh.db"));
    const applied = sqlite.prepare("select id, name from schema_migrations order by id").all() as { id: number }[];
    expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    // post_sources: 複合PK+FK2本
    const fks = fkList(sqlite, "post_sources");
    expect(fks.map((f) => f.table).sort()).toEqual(["posts", "sources"]);
    const idx = sqlite.pragma("index_list(post_sources)") as { origin: string }[];
    expect(idx.some((i) => i.origin === "pk")).toBe(true);
    // portfolio_items / qa_reviews / reports のFK
    expect(fkList(sqlite, "portfolio_items").map((f) => f.table)).toContain("customer_permissions");
    expect(fkList(sqlite, "qa_reviews").map((f) => f.table)).toContain("posts");
    expect(fkList(sqlite, "reports").map((f) => f.table)).toContain("artifacts");
    // 検索インデックス
    const postIdx = (sqlite.pragma("index_list(posts)") as { name: string }[]).map((i) => i.name);
    expect(postIdx).toEqual(expect.arrayContaining(["posts_status_idx", "posts_planned_idx", "posts_created_idx"]));
    sqlite.close();
  });

  it("V2形式DBへのmigration: 既存の投稿・成果物・承認履歴が保持され、新列が追加される", () => {
    const raw = makeV2Db("v2.db");
    // V2形状であること(template_id列がまだ無い)
    const beforeCols = (raw.pragma("table_info(posts)") as { name: string }[]).map((c) => c.name);
    expect(beforeCols).not.toContain("template_id");
    raw.prepare("insert into posts (id, pillar, format, title, status) values ('p1', '6', 'carousel', '旧投稿', 'approved')").run();
    raw.prepare("insert into departments (id, name, status) values ('d1', '部', 'active')").run();
    raw.prepare("insert into employees (id, department_id, name, role, agent_ref, model_profile) values ('e1','d1','葵','補佐','aoi','standard')").run();
    raw.prepare(
      "insert into tasks (id, idempotency_key, type, title, assignee_id, status, run_date, created_at) values ('t1','k1','qa','旧タスク','e1','done','2026-07-01','2026-07-01T00:00:00Z')",
    ).run();
    raw.prepare(
      "insert into artifacts (id, task_id, post_id, kind, version, schema_version, created_at) values ('a1','t1','p1','copy',1,'v1','2026-07-01T00:00:00Z')",
    ).run();
    raw.prepare(
      "insert into approvals (id, subject_type, subject_id, decision, decided_by, decided_at) values ('ap1','post','p1','approved','owner','2026-07-01T00:00:00Z')",
    ).run();
    raw.prepare("insert into sources (id, title, url, publisher, published_at, checked_at, reliability, fact_or_inference) values ('s1','旧記事','https://example.com/old','旧社','2026-06-01','2026-06-02','high','fact')").run();
    raw.prepare("insert into post_sources (post_id, source_id) values ('p1','s1')").run();
    raw.close();

    const { db, sqlite } = openDb(path.join(dir, "v2.db"));
    void db;
    // データ保持
    expect((sqlite.prepare("select count(*) n from posts").get() as { n: number }).n).toBe(1);
    expect((sqlite.prepare("select title from posts where id='p1'").get() as { title: string }).title).toBe("旧投稿");
    expect((sqlite.prepare("select count(*) n from artifacts").get() as { n: number }).n).toBe(1);
    expect((sqlite.prepare("select decision from approvals where id='ap1'").get() as { decision: string }).decision).toBe("approved");
    expect((sqlite.prepare("select count(*) n from post_sources").get() as { n: number }).n).toBe(1);
    // 新列がデフォルトで埋まる
    const post = sqlite.prepare("select template_id from posts where id='p1'").get() as { template_id: string };
    expect(post.template_id).toBe("tpl-howto");
    sqlite.close();
  });

  it("migration再実行は何もしない(冪等)", () => {
    const first = openDb(path.join(dir, "rerun.db"));
    first.sqlite.close();
    const second = openDb(path.join(dir, "rerun.db"));
    const ran = runMigrations(second.sqlite);
    expect(ran).toEqual([]);
    second.sqlite.close();
  });

  it("途中失敗時はロールバックされ、部分適用が残らない", () => {
    const { sqlite } = openDb(path.join(dir, "fail.db"));
    const failing: Migration = {
      id: 999,
      name: "test-failing",
      up(s) {
        s.exec("CREATE TABLE mig_test_table (id TEXT PRIMARY KEY)");
        throw new Error("boom");
      },
    };
    expect(() => runMigrations(sqlite, [failing])).toThrow(/boom/);
    // 部分適用なし: テーブルもschema_migrations記録も残らない
    const tables = (sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).not.toContain("mig_test_table");
    const rec = sqlite.prepare("select count(*) n from schema_migrations where id=999").get() as { n: number };
    expect(rec.n).toBe(0);
    sqlite.close();
  });

  it("孤立データがあるV2 DBは日本語の理由+修復方法つきで停止し、データを変更しない", () => {
    const raw = makeV2Db("orphan.db");
    raw.prepare("insert into post_sources (post_id, source_id) values ('no-post', 'no-source')").run();
    raw.close();
    expect(() => openDb(path.join(dir, "orphan.db"))).toThrow(MigrationError);
    try {
      openDb(path.join(dir, "orphan.db"));
    } catch (e) {
      expect((e as Error).message).toMatch(/修復方法/);
      expect((e as Error).message).toMatch(/参照先のない行/);
    }
    // データは残っている(勝手に削除しない)
    const check = new Database(path.join(dir, "orphan.db"));
    expect((check.prepare("select count(*) n from post_sources").get() as { n: number }).n).toBe(1);
    check.close();
  });

  it("孤立artifact参照(qa_reviews.artifact_id)があるV2 DBは日本語で停止する(P2)", () => {
    const raw = makeV2Db("orphan-artifact.db");
    raw.prepare("insert into posts (id, pillar, format, title, status) values ('p1','6','carousel','x','idea')").run();
    raw.prepare(
      "insert into qa_reviews (id, post_id, artifact_id, result, reviewer_id, created_at) values ('q1','p1','no-such-artifact','pass','emp_shion','2026-01-01T00:00:00Z')",
    ).run();
    raw.close();
    try {
      openDb(path.join(dir, "orphan-artifact.db"));
      expect.unreachable("停止するはず");
    } catch (e) {
      expect(e).toBeInstanceOf(MigrationError);
      expect((e as Error).message).toMatch(/存在しない成果物/);
      expect((e as Error).message).toMatch(/修復方法/);
    }
  });

  it("openDbはmigration失敗時に接続をクローズする(P2)", () => {
    const raw = makeV2Db("close-check.db");
    raw.prepare("insert into post_sources (post_id, source_id) values ('no-post', 'no-source')").run();
    raw.close();
    const closeSpy = vi.spyOn(Database.prototype, "close");
    expect(() => openDb(path.join(dir, "close-check.db"))).toThrow(MigrationError);
    expect(closeSpy).toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  it("Drizzle schema定義がDDLと整合している(複合PK・FK)(P2)", () => {
    const { postSources, portfolioItems, qaReviews, reports } = schema;
    const ps = getTableConfig(postSources);
    expect(ps.primaryKeys[0]?.columns.map((c) => c.name).sort()).toEqual(["post_id", "source_id"]);
    expect(ps.foreignKeys).toHaveLength(2);
    expect(getTableConfig(portfolioItems).foreignKeys).toHaveLength(1);
    expect(getTableConfig(qaReviews).foreignKeys).toHaveLength(2);
    expect(getTableConfig(reports).foreignKeys).toHaveLength(1);
    // 実DB側のFKとも一致(openDb後のpragmaで確認)
    const { sqlite } = openDb(path.join(dir, "schema-sync.db"));
    expect(fkList(sqlite, "post_sources")).toHaveLength(2);
    expect(fkList(sqlite, "qa_reviews")).toHaveLength(2);
    sqlite.close();
  });

  it("migration後: post_sourcesの重複INSERTとFK違反INSERTが拒否される", () => {
    const { sqlite } = openDb(path.join(dir, "constraints.db"));
    sqlite.prepare("insert into posts (id, pillar, format, title, status, template_id) values ('p1','6','carousel','x','idea','tpl-howto')").run();
    sqlite.prepare("insert into sources (id, title, url, publisher, published_at, checked_at, reliability, fact_or_inference) values ('s1','t','https://example.com/a','p','2026-01-01','2026-01-02','high','fact')").run();
    sqlite.prepare("insert into post_sources (post_id, source_id) values ('p1','s1')").run();
    expect(() => sqlite.prepare("insert into post_sources (post_id, source_id) values ('p1','s1')").run()).toThrow(/UNIQUE|PRIMARY/i);
    expect(() => sqlite.prepare("insert into post_sources (post_id, source_id) values ('p1','no-source')").run()).toThrow(/FOREIGN KEY/i);
    expect(() => sqlite.prepare("insert into qa_reviews (id, post_id, result, reviewer_id, created_at) values ('q1','no-post','pass','e','2026-01-01T00:00:00Z')").run()).toThrow(/FOREIGN KEY/i);
    sqlite.close();
  });
});
