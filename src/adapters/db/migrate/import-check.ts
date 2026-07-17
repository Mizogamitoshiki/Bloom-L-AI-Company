/**
 * V5.4 PostgreSQL取り込みの境界と事前検証。
 * 実PostgreSQLへの接続・投入はV5.4では未実装(移行準備のみ)。ここで「成功した」と偽らない。
 * - db-import-check: エクスポート成果物をmanifest/SHA-256/件数/重複PK/FK/スキーマ版で検証し、
 *   import順・件数・移行単位(全体で1トランザクション)を提示する
 * - db-import-postgres: 既定はdry-run。--execute でも DATABASE_PROVIDER=postgres と DATABASE_URL が
 *   揃わなければ拒否し、揃っていても実装が無い間は接続前に停止する(fail closed)
 */
import { MIGRATIONS } from "../migrations";
import { resolveDatabaseProvider } from "../provider";
import { DB_EXPORT_VERSION, EXPORT_TABLES, verifyDbExport, type DbExportVerifyReport } from "./export";

export interface ImportCheckReport {
  ok: boolean;
  from: string;
  exportVersion: string | null;
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  /** 親→子の投入順(この順で1トランザクションとして投入する設計) */
  importOrder: string[];
  tables: { name: string; rows: number }[];
  totalRows: number;
  transactionPlan: string;
  idempotencyPlan: string;
  problems: string[];
  warnings: string[];
}

/** エクスポート成果物がPostgreSQLへ投入可能かを、実接続なしで検証する。 */
export function checkImportSource(fromDir: string): ImportCheckReport {
  const expected = Math.max(...MIGRATIONS.map((m) => m.id));
  const verify: DbExportVerifyReport = verifyDbExport(fromDir);
  const problems = [...verify.problems];
  const warnings = [...verify.warnings];

  if (verify.exportVersion === DB_EXPORT_VERSION && verify.schemaVersion !== null && verify.schemaVersion !== expected) {
    problems.push(
      `schema versionが一致しません(エクスポート ${verify.schemaVersion} / 期待 ${expected})。` +
        "古いエクスポートは使わず、最新コードで pnpm company db-export を再実行してください",
    );
  }

  const tables = verify.tables.filter((t) => t.rows >= 0).map((t) => ({ name: t.name, rows: t.rows }));
  return {
    ok: problems.length === 0,
    from: fromDir,
    exportVersion: verify.exportVersion,
    schemaVersion: verify.schemaVersion,
    expectedSchemaVersion: expected,
    importOrder: EXPORT_TABLES.map((t) => t.name),
    tables,
    totalRows: tables.reduce((a, t) => a + t.rows, 0),
    transactionPlan: "全テーブルを1つのトランザクションで投入し、途中失敗時は全体をロールバックする(部分適用なし)",
    idempotencyPlan:
      "manifest.json全体のSHA-256をimport_idとして、移行先PostgreSQLの import_history 表(schema.sql定義・PRIMARY KEY)へ" +
      "同一トランザクション内で記録する。同一import_idの再importは主キー違反で拒否される(二重import防止)",
    problems,
    warnings,
  };
}

export interface ImportRunResult {
  ok: boolean;
  executed: false;
  dryRun: boolean;
  check: ImportCheckReport;
  message: string;
}

/**
 * PostgreSQLへのimport(V5.4では常にdry-runまでで停止)。
 * 実行条件が全て揃っていても、接続実装が存在しない間はネットワーク接続前に必ず停止する。
 */
export function runPostgresImport(
  fromDir: string,
  actor: string,
  options: { execute?: boolean; env?: Record<string, string | undefined> } = {},
): ImportRunResult {
  if (actor !== "owner") {
    throw new Error("db-import-postgres は代表者(owner)専用です。--actor owner を明示してください");
  }
  const check = checkImportSource(fromDir);
  if (!check.ok) {
    return {
      ok: false,
      executed: false,
      dryRun: true,
      check,
      message: "事前検証に失敗したため、importは実行できません(dry-run止まり)",
    };
  }
  if (!options.execute) {
    return {
      ok: true,
      executed: false,
      dryRun: true,
      check,
      message: "dry-run完了(既定)。実行には --execute と DATABASE_PROVIDER=postgres・DATABASE_URL の設定が必要です",
    };
  }
  // --execute: 環境の前提を先に検査(fail closed)。DATABASE_URLの値はログへ出さない。
  const env = options.env ?? process.env;
  const resolved = resolveDatabaseProvider(env); // postgres+URLなし はここで例外
  if (resolved.provider !== "postgres") {
    throw new Error("importの実行には DATABASE_PROVIDER=postgres が必要です(現在はsqlite)");
  }
  // ここまで到達しても、V5.4には実接続の実装が無い。偽装せず停止する(外部通信は発生していない)。
  throw new Error(
    "PostgreSQLへの実importはV5.4では未実装です(移行準備のみ完了)。" +
      "実装追加までは dry-run(db-import-check / --dry-run)だけが利用できます。実データへの接続・投入は行っていません",
  );
}
