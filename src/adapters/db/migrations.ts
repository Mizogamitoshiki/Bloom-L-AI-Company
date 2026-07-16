/**
 * バージョン付きDBマイグレーション(V3レビュー指摘3, 2026-07-13)。
 * - schema_migrations テーブルで適用済みを管理(再実行は冪等)
 * - 各migrationは1つのSQLiteトランザクションで実行し、途中失敗時は部分適用を残さない
 * - FK後付けが必要なテーブルは安全なテーブル再構築(create new → copy → drop → rename)
 * - 既存データは削除しない。重複・孤立データは事前検査し、問題があれば日本語で停止理由と修復方法を提示する
 */
import type Database from "better-sqlite3";

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface Migration {
  id: number;
  name: string;
  /** 適用前の検査。問題があれば MigrationError(日本語の理由+修復方法) を投げる。データ変更禁止 */
  precheck?(sqlite: Database.Database): void;
  up(sqlite: Database.Database): void;
}

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  const cols = sqlite.pragma(`table_info(${table})`) as { name: string }[];
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, ddl: string): void {
  if (!hasColumn(sqlite, table, column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function count(sqlite: Database.Database, sql: string): number {
  return (sqlite.prepare(sql).get() as { n: number }).n;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "v3-additive-columns",
    up(sqlite) {
      addColumnIfMissing(sqlite, "posts", "template_id", "template_id TEXT NOT NULL DEFAULT 'tpl-howto'");
      addColumnIfMissing(sqlite, "posts", "portfolio_item_id", "portfolio_item_id TEXT");
      addColumnIfMissing(sqlite, "posts", "created_at", "created_at TEXT");
      addColumnIfMissing(sqlite, "sources", "fetched_at", "fetched_at TEXT");
      addColumnIfMissing(sqlite, "sources", "usable", "usable INTEGER NOT NULL DEFAULT 1");
      addColumnIfMissing(sqlite, "sources", "verification_status", "verification_status TEXT NOT NULL DEFAULT 'confirmed'");
      addColumnIfMissing(sqlite, "customer_permissions", "anonymous_allowed", "anonymous_allowed INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(sqlite, "customer_permissions", "revoked_at", "revoked_at TEXT");
      addColumnIfMissing(sqlite, "portfolio_items", "anonymous_name", "anonymous_name TEXT");
      addColumnIfMissing(sqlite, "portfolio_items", "summary", "summary TEXT");
      addColumnIfMissing(sqlite, "portfolio_items", "technologies_json", "technologies_json TEXT");
      addColumnIfMissing(sqlite, "portfolio_items", "problem", "problem TEXT");
      addColumnIfMissing(sqlite, "portfolio_items", "testimonial", "testimonial TEXT");
      addColumnIfMissing(sqlite, "qa_reviews", "notes_json", "notes_json TEXT");
      sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS sources_url_uq ON sources(url)");
    },
  },
  {
    id: 2,
    name: "v3-fk-rebuild",
    precheck(sqlite) {
      const problems: string[] = [];
      const dup = count(
        sqlite,
        "select count(*) n from (select post_id, source_id, count(*) c from post_sources group by post_id, source_id having c > 1)",
      );
      if (dup > 0) {
        problems.push(
          `post_sourcesに重複が${dup}組あります。修復方法: 重複行を確認し(select post_id, source_id, count(*) from post_sources group by 1,2 having count(*)>1)、残す1行を決めて手動で削除してください`,
        );
      }
      const orphanPs = count(
        sqlite,
        "select count(*) n from post_sources ps where not exists (select 1 from posts p where p.id = ps.post_id) or not exists (select 1 from sources s where s.id = ps.source_id)",
      );
      if (orphanPs > 0) {
        problems.push(
          `post_sourcesに参照先のない行が${orphanPs}件あります。修復方法: 該当行の投稿ID/情報源IDを確認し、正しいIDへ修正するか手動で削除してください`,
        );
      }
      const orphanPerm = count(
        sqlite,
        "select count(*) n from portfolio_items pi where pi.permission_id is not null and not exists (select 1 from customer_permissions cp where cp.id = pi.permission_id)",
      );
      if (orphanPerm > 0) {
        problems.push(
          `portfolio_itemsに存在しない許可レコードを参照する行が${orphanPerm}件あります。修復方法: 許可レコードを作成するか、permission_idを修正してください`,
        );
      }
      const orphanQa = count(
        sqlite,
        "select count(*) n from qa_reviews q where not exists (select 1 from posts p where p.id = q.post_id)",
      );
      if (orphanQa > 0) {
        problems.push(`qa_reviewsに投稿の存在しない行が${orphanQa}件あります。修復方法: 該当行のpost_idを確認してください`);
      }
      const orphanQaArtifact = count(
        sqlite,
        "select count(*) n from qa_reviews q where q.artifact_id is not null and not exists (select 1 from artifacts a where a.id = q.artifact_id)",
      );
      if (orphanQaArtifact > 0) {
        problems.push(
          `qa_reviewsに存在しない成果物を参照する行が${orphanQaArtifact}件あります。修復方法: 該当行のartifact_idを確認し(select id, artifact_id from qa_reviews where artifact_id not in (select id from artifacts))、正しいIDへ修正するかNULLにしてください`,
        );
      }
      const orphanRep = count(
        sqlite,
        "select count(*) n from reports r where r.body_artifact_id is not null and not exists (select 1 from artifacts a where a.id = r.body_artifact_id)",
      );
      if (orphanRep > 0) {
        problems.push(`reportsに成果物の存在しない行が${orphanRep}件あります。修復方法: body_artifact_idを確認してください`);
      }
      if (problems.length > 0) {
        throw new MigrationError(
          `マイグレーションを停止しました(データは変更していません)。\n${problems.map((p) => `- ${p}`).join("\n")}\n修復後に再度起動してください。`,
        );
      }
    },
    up(sqlite) {
      // post_sources: 複合PRIMARY KEY + FK(重複・孤立はprecheckで停止済みなのでそのままコピー)
      sqlite.exec(`
        CREATE TABLE post_sources_new (
          post_id TEXT NOT NULL REFERENCES posts(id),
          source_id TEXT NOT NULL REFERENCES sources(id),
          cited_as TEXT,
          PRIMARY KEY (post_id, source_id)
        );
        INSERT INTO post_sources_new (post_id, source_id, cited_as)
          SELECT post_id, source_id, cited_as FROM post_sources;
        DROP TABLE post_sources;
        ALTER TABLE post_sources_new RENAME TO post_sources;
      `);
      // portfolio_items: permission_id へFK
      sqlite.exec(`
        CREATE TABLE portfolio_items_new (
          id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, site_url TEXT, assets_path TEXT,
          highlights_json TEXT, permission_id TEXT REFERENCES customer_permissions(id), created_at TEXT NOT NULL,
          anonymous_name TEXT, summary TEXT, technologies_json TEXT, problem TEXT, testimonial TEXT
        );
        INSERT INTO portfolio_items_new
          SELECT id, customer_name, site_url, assets_path, highlights_json, permission_id, created_at,
                 anonymous_name, summary, technologies_json, problem, testimonial FROM portfolio_items;
        DROP TABLE portfolio_items;
        ALTER TABLE portfolio_items_new RENAME TO portfolio_items;
      `);
      // qa_reviews: post_id / artifact_id へFK
      sqlite.exec(`
        CREATE TABLE qa_reviews_new (
          id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
          artifact_id TEXT REFERENCES artifacts(id), result TEXT NOT NULL,
          checklist_json TEXT, issues_json TEXT, reviewer_id TEXT NOT NULL, created_at TEXT NOT NULL,
          notes_json TEXT
        );
        INSERT INTO qa_reviews_new
          SELECT id, post_id, artifact_id, result, checklist_json, issues_json, reviewer_id, created_at, notes_json
          FROM qa_reviews;
        DROP TABLE qa_reviews;
        ALTER TABLE qa_reviews_new RENAME TO qa_reviews;
      `);
      // reports: body_artifact_id へFK
      sqlite.exec(`
        CREATE TABLE reports_new (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
          body_artifact_id TEXT REFERENCES artifacts(id)
        );
        INSERT INTO reports_new SELECT id, kind, period_start, period_end, body_artifact_id FROM reports;
        DROP TABLE reports;
        ALTER TABLE reports_new RENAME TO reports;
      `);
    },
  },
  {
    id: 3,
    name: "v3-indexes",
    up(sqlite) {
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS posts_status_idx ON posts(status);
        CREATE INDEX IF NOT EXISTS posts_planned_idx ON posts(planned_date);
        CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at);
        CREATE INDEX IF NOT EXISTS artifacts_post_idx ON artifacts(post_id, kind, version);
        CREATE INDEX IF NOT EXISTS qa_reviews_post_idx ON qa_reviews(post_id, created_at);
        CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events(task_id, seq);
        CREATE INDEX IF NOT EXISTS usage_records_ts_idx ON usage_records(ts);
        CREATE INDEX IF NOT EXISTS portfolio_items_perm_idx ON portfolio_items(permission_id);
      `);
    },
  },
  {
    id: 4,
    name: "v4-metrics-meetings-fk",
    precheck(sqlite) {
      const problems: string[] = [];
      const orphanMetrics = count(
        sqlite,
        "select count(*) n from post_metrics m where not exists (select 1 from posts p where p.id = m.post_id)",
      );
      if (orphanMetrics > 0) {
        problems.push(
          `post_metricsに投稿の存在しない行が${orphanMetrics}件あります。修復方法: select id, post_id from post_metrics where post_id not in (select id from posts) で確認し、正しいpost_idへ修正するか手動削除してください`,
        );
      }
      const orphanMinutes = count(
        sqlite,
        "select count(*) n from meetings mt where mt.minutes_artifact_id is not null and not exists (select 1 from artifacts a where a.id = mt.minutes_artifact_id)",
      );
      if (orphanMinutes > 0) {
        problems.push(
          `meetingsに存在しない成果物を参照する行が${orphanMinutes}件あります。修復方法: 該当行のminutes_artifact_idを確認し修正するかNULLにしてください`,
        );
      }
      if (problems.length > 0) {
        throw new MigrationError(
          `マイグレーションを停止しました(データは変更していません)。\n${problems.map((p) => `- ${p}`).join("\n")}\n修復後に再度起動してください。`,
        );
      }
    },
    up(sqlite) {
      // post_metrics: post_id へFK + index。V4-Cで代表者が3日/7日後に手入力する実績値
      sqlite.exec(`
        CREATE TABLE post_metrics_new (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id),
          measured_at TEXT NOT NULL,
          window_days INTEGER,
          reach INTEGER, profile_views INTEGER, saves INTEGER, shares INTEGER,
          comments INTEGER, dm_starts INTEGER, follower_count INTEGER, note TEXT,
          created_at TEXT
        );
        INSERT INTO post_metrics_new (id, post_id, measured_at, reach, profile_views, saves, shares, comments, dm_starts, follower_count, note)
          SELECT id, post_id, measured_at, reach, profile_views, saves, shares, comments, dm_starts, follower_count, note FROM post_metrics;
        DROP TABLE post_metrics;
        ALTER TABLE post_metrics_new RENAME TO post_metrics;
        CREATE INDEX IF NOT EXISTS post_metrics_post_idx ON post_metrics(post_id, window_days);
      `);
      // meetings: minutes_artifact_id へFK + 期間列 + 参加者。議事録本体は meeting_minutes 成果物
      sqlite.exec(`
        CREATE TABLE meetings_new (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          held_on TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          participants_json TEXT,
          agenda_json TEXT,
          decisions_json TEXT,
          minutes_artifact_id TEXT REFERENCES artifacts(id),
          created_at TEXT
        );
        INSERT INTO meetings_new (id, kind, held_on, agenda_json, decisions_json, minutes_artifact_id)
          SELECT id, kind, held_on, agenda_json, decisions_json, minutes_artifact_id FROM meetings;
        DROP TABLE meetings;
        ALTER TABLE meetings_new RENAME TO meetings;
        CREATE INDEX IF NOT EXISTS meetings_kind_idx ON meetings(kind, held_on);
      `);
    },
  },
  {
    id: 5,
    name: "v4-unique-metrics-meetings",
    precheck(sqlite) {
      const duplicateMetrics = count(
        sqlite,
        "select count(*) n from (select post_id, window_days from post_metrics where window_days is not null group by post_id, window_days having count(*) > 1)",
      );
      const duplicateMeetings = count(
        sqlite,
        "select count(*) n from (select kind, period_end from meetings where period_end is not null group by kind, period_end having count(*) > 1)",
      );
      const problems: string[] = [];
      if (duplicateMetrics > 0) {
        problems.push(`post_metricsに同じ投稿・計測窓の重複が${duplicateMetrics}組あります。各組で残す計測値を確認し、重複行を手動整理してください`);
      }
      if (duplicateMeetings > 0) {
        problems.push(`meetingsに同じ種別・期間終了日の重複が${duplicateMeetings}組あります。最新の議事録を残すよう手動整理してください`);
      }
      if (problems.length > 0) {
        throw new MigrationError(`マイグレーションを停止しました(データは変更していません)。\n${problems.map((p) => `- ${p}`).join("\n")}`);
      }
    },
    up(sqlite) {
      sqlite.exec(`
        DROP INDEX IF EXISTS post_metrics_post_idx;
        CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_post_window_uq ON post_metrics(post_id, window_days);
        CREATE UNIQUE INDEX IF NOT EXISTS meetings_kind_period_uq ON meetings(kind, period_end);
      `);
    },
  },
  {
    // V4.5: 公開停止ガード。テンプレート版承認(template_versions)と投稿レンダリング記録(post_renders)。
    // 新規テーブルのみ(既存データ・既存export記録は不変)。1トランザクション・再実行可能・FK整合。
    id: 6,
    name: "v45-template-versions-post-renders",
    up(sqlite) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS template_versions (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          family TEXT NOT NULL,
          version INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          fingerprint TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL,
          decided_at TEXT,
          decided_by TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS template_versions_tpl_ver_uq ON template_versions(template_id, version);

        CREATE TABLE IF NOT EXISTS post_renders (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id),
          spec_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
          template_id TEXT NOT NULL,
          template_version INTEGER NOT NULL,
          variant TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          design_qa_result TEXT,
          design_qa_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS post_renders_post_idx ON post_renders(post_id, created_at);
      `);
    },
  },
  {
    // V4.5 v2: 紫苑visual QAの接続。post_rendersにvisual QA列を追加し、
    // テンプレート版×variantのQA/プレビュー状態(template_variant_qa)を新設。
    // 追加のみ(既存データ・既存post_renders・既存export記録は不変)。1トランザクション・再実行可能・FK整合。
    id: 7,
    name: "v45-visual-qa-variant-gate",
    up(sqlite) {
      addColumnIfMissing(sqlite, "post_renders", "visual_qa_result", "visual_qa_result TEXT");
      addColumnIfMissing(sqlite, "post_renders", "visual_qa_json", "visual_qa_json TEXT");
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS template_variant_qa (
          id TEXT PRIMARY KEY,
          template_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          variant TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          content_qa_result TEXT,
          mechanical_qa_result TEXT,
          visual_qa_result TEXT,
          visual_qa_json TEXT,
          preview_complete INTEGER NOT NULL DEFAULT 0,
          page_count INTEGER,
          fixture_kind TEXT,
          rights TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS template_variant_qa_uq ON template_variant_qa(template_id, version, variant);
      `);
    },
  },
  {
    // V4.5 v3: variant差分の構造判定のため、各variantのlayoutIdと画像ハッシュを保存する。追加のみ。
    id: 8,
    name: "v45-variant-layout-hashes",
    up(sqlite) {
      addColumnIfMissing(sqlite, "template_variant_qa", "layout_ids_json", "layout_ids_json TEXT");
      addColumnIfMissing(sqlite, "template_variant_qa", "page_hashes_json", "page_hashes_json TEXT");
    },
  },
  {
    // V5: Metaへ公開した事実をローカル記録より先に永続化し、再実行で二重投稿しない。
    // アクセストークン、IG user ID等の秘密情報は保存しない。
    id: 9,
    name: "v5-instagram-publish-jobs",
    up(sqlite) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS instagram_publish_jobs (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id),
          idempotency_key TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          media_urls_json TEXT NOT NULL,
          child_container_ids_json TEXT,
          carousel_container_id TEXT,
          instagram_media_id TEXT,
          error_code TEXT,
          error_message TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          published_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS instagram_publish_jobs_idem_uq ON instagram_publish_jobs(idempotency_key);
        CREATE INDEX IF NOT EXISTS instagram_publish_jobs_post_idx ON instagram_publish_jobs(post_id, created_at);
      `);
    },
  },
  {
    // V5.2: 公開画像URLの記録(post_media_uploads)。export bundleの確定画像を
    // 公開ストレージへアップロードした結果(順序・SHA-256・公開URL・provider)を保持する。
    // 追加のみ(既存データ・既存ジョブは不変)。1トランザクション・再実行可能・FK整合。
    id: 10,
    name: "v52-post-media-uploads",
    up(sqlite) {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS post_media_uploads (
          id TEXT PRIMARY KEY,
          post_id TEXT NOT NULL REFERENCES posts(id),
          image_index INTEGER NOT NULL,
          file_name TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          public_url TEXT NOT NULL,
          provider TEXT NOT NULL,
          uploaded_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS post_media_uploads_post_idx_uq ON post_media_uploads(post_id, image_index);
        CREATE INDEX IF NOT EXISTS post_media_uploads_sha_idx ON post_media_uploads(provider, sha256);
      `);
    },
  },
];

/**
 * 未適用のmigrationを順に適用する。
 * - 各migrationは foreign_keys OFF → トランザクション → foreign_key_check → コミット → foreign_keys ON
 * - 失敗時はロールバックし、schema_migrationsにも記録しない(部分適用なし)
 */
export function runMigrations(sqlite: Database.Database, migrations: Migration[] = MIGRATIONS): number[] {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = new Set((sqlite.prepare("select id from schema_migrations").all() as { id: number }[]).map((r) => r.id));
  const ran: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) continue;
    m.precheck?.(sqlite);
    // テーブル再構築のためFKを一時無効化(トランザクション外でのみ変更可能)
    sqlite.pragma("foreign_keys = OFF");
    try {
      const tx = sqlite.transaction(() => {
        m.up(sqlite);
        const violations = sqlite.pragma("foreign_key_check") as unknown[];
        if (violations.length > 0) {
          throw new MigrationError(
            `マイグレーション ${m.id}(${m.name}) で外部キー違反が${violations.length}件検出されたため中止しました。データは変更されていません`,
          );
        }
        sqlite
          .prepare("insert into schema_migrations (id, name, applied_at) values (?, ?, ?)")
          .run(m.id, m.name, new Date().toISOString());
      });
      tx();
      ran.push(m.id);
    } finally {
      sqlite.pragma("foreign_keys = ON");
    }
  }
  return ran;
}
