/**
 * V5.4 SQLite→中間形式(JSONL)エクスポート。PostgreSQL移行の入力データを作る。
 * - 実DBは一切変更しない(better-sqlite3 readonly接続。openDbは使わない=migrationも走らせない)
 * - 全読み取りは1つの読み取りトランザクション内で行い、単一時点のスナップショットになる
 * - 決定的出力: 主キー順に整列し、各行はキーをソートしたJSON 1行。同じDB状態なら同じ内容になる
 * - tmpディレクトリへ全て書き出してから atomic rename。途中失敗で不完全な正式成果物を残さない
 * - manifest.json に件数・SHA-256・bytes・schema version・FK参照件数を記録し、改ざん・欠損を検知できる
 * - 秘密値は扱わない(DBには設計上トークン等を保存していない。manifestにも絶対パスを書かない)
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { findRepoRoot } from "../../root";
import { defaultDbPath } from "../client";
import { MIGRATIONS } from "../migrations";

export const DB_EXPORT_VERSION = "db-export-v1";

/** 複合主キーの結合子(ULID/ファイル名に現れない制御文字。重複判定専用) */
const PK_JOINER = "\u001F";

export interface ForeignKeySpec {
  column: string;
  refTable: string;
  refColumn: string;
  nullable: boolean;
}

export interface ExportTableSpec {
  name: string;
  /** 主キー列(整列と重複検査に使う) */
  pk: string[];
  /** SQLite実スキーマに存在する外部キーのみ(勝手に強化しない) */
  fks: ForeignKeySpec[];
}

/** import順(親→子)。この順のままPostgreSQLへ投入すればFK違反にならない。 */
export const EXPORT_TABLES: ExportTableSpec[] = [
  { name: "schema_migrations", pk: ["id"], fks: [] },
  { name: "departments", pk: ["id"], fks: [] },
  { name: "employees", pk: ["id"], fks: [{ column: "department_id", refTable: "departments", refColumn: "id", nullable: false }] },
  { name: "customer_permissions", pk: ["id"], fks: [] },
  { name: "portfolio_items", pk: ["id"], fks: [{ column: "permission_id", refTable: "customer_permissions", refColumn: "id", nullable: true }] },
  { name: "posts", pk: ["id"], fks: [] },
  { name: "sources", pk: ["id"], fks: [] },
  {
    name: "post_sources",
    pk: ["post_id", "source_id"],
    fks: [
      { column: "post_id", refTable: "posts", refColumn: "id", nullable: false },
      { column: "source_id", refTable: "sources", refColumn: "id", nullable: false },
    ],
  },
  {
    name: "tasks",
    pk: ["id"],
    fks: [
      { column: "assignee_id", refTable: "employees", refColumn: "id", nullable: false },
      { column: "post_id", refTable: "posts", refColumn: "id", nullable: true },
    ],
  },
  { name: "task_events", pk: ["id"], fks: [{ column: "task_id", refTable: "tasks", refColumn: "id", nullable: false }] },
  { name: "artifacts", pk: ["id"], fks: [{ column: "task_id", refTable: "tasks", refColumn: "id", nullable: false }] },
  {
    name: "qa_reviews",
    pk: ["id"],
    fks: [
      { column: "post_id", refTable: "posts", refColumn: "id", nullable: false },
      { column: "artifact_id", refTable: "artifacts", refColumn: "id", nullable: true },
    ],
  },
  { name: "approvals", pk: ["id"], fks: [] },
  { name: "audit_log", pk: ["id"], fks: [] },
  { name: "runs", pk: ["id"], fks: [] },
  { name: "usage_records", pk: ["id"], fks: [{ column: "task_id", refTable: "tasks", refColumn: "id", nullable: false }] },
  { name: "settings", pk: ["key"], fks: [] },
  { name: "reports", pk: ["id"], fks: [{ column: "body_artifact_id", refTable: "artifacts", refColumn: "id", nullable: true }] },
  { name: "post_metrics", pk: ["id"], fks: [{ column: "post_id", refTable: "posts", refColumn: "id", nullable: false }] },
  { name: "meetings", pk: ["id"], fks: [{ column: "minutes_artifact_id", refTable: "artifacts", refColumn: "id", nullable: true }] },
  { name: "template_versions", pk: ["id"], fks: [] },
  { name: "template_variant_qa", pk: ["id"], fks: [] },
  {
    name: "post_renders",
    pk: ["id"],
    fks: [
      { column: "post_id", refTable: "posts", refColumn: "id", nullable: false },
      { column: "spec_artifact_id", refTable: "artifacts", refColumn: "id", nullable: false },
    ],
  },
  { name: "instagram_publish_jobs", pk: ["id"], fks: [{ column: "post_id", refTable: "posts", refColumn: "id", nullable: false }] },
  { name: "post_media_uploads", pk: ["id"], fks: [{ column: "post_id", refTable: "posts", refColumn: "id", nullable: false }] },
];

export interface ExportManifestTable {
  name: string;
  file: string;
  rows: number;
  sha256: string;
  bytes: number;
}

export interface ExportManifest {
  exportVersion: string;
  /** 適用済みmigrationの最大ID(=SQLiteスキーマの版) */
  schemaVersion: number;
  /** このコードベースが期待するmigration最大ID */
  expectedSchemaVersion: number;
  createdAt: string;
  /** 絶対パスを含めない(basenameのみ) */
  dbFile: string;
  totalRows: number;
  tables: ExportManifestTable[];
  /** FK参照の検査済み件数(export時点でSQLite側の整合を確認した記録) */
  fkChecked: { table: string; column: string; refTable: string; rows: number }[];
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function stableRowJson(row: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    const value = row[key];
    if (Buffer.isBuffer(value)) {
      // 現行スキーマにBLOB列は存在しない。想定外データは黙って変換せず停止する。
      throw new Error(`BLOB値は想定外です(列 ${key})。エクスポートを中止しました`);
    }
    sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

export function dbExportRoot(env: Record<string, string | undefined> = process.env): string {
  const backupRoot = env.BLOOM_BACKUP_PATH ?? path.join(findRepoRoot(), "data", "backups");
  return path.join(path.resolve(backupRoot), "db-export");
}

export interface DbExportResult {
  outDir: string;
  manifest: ExportManifest;
}

/**
 * 実DBを読み取り専用で開き、全対象テーブルをJSONL+manifestへ書き出す(owner専用)。
 * V5.4レビュー修正3: 全読み取り(スキーマ版・全テーブル・FK検査)を1つの読み取りトランザクションで
 * 囲む。export中に別接続から書き込みがあっても、export内容は単一時点のスナップショットになる。
 */
export function runDbExport(
  actor: string,
  options: {
    dbPath?: string;
    outDir?: string;
    now?: Date;
    /** テーブル1件の書き出し完了ごとに呼ばれる(進捗表示・テストでの並行書き込み再現用) */
    onTableExported?: (tableName: string) => void;
  } = {},
): DbExportResult {
  if (actor !== "owner") {
    throw new Error("db-export は代表者(owner)専用です。--actor owner を明示してください");
  }
  const dbPath = options.dbPath ?? process.env.BLOOM_DB_PATH ?? defaultDbPath();
  if (!existsSync(dbPath)) throw new Error(`DBファイルが見つかりません: ${path.basename(dbPath)}`);
  const now = options.now ?? new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(options.outDir ?? path.join(dbExportRoot(), stamp));
  if (existsSync(outDir)) throw new Error(`出力先が既に存在します: ${outDir}(別の出力先を指定してください)`);
  const tmpDir = `${outDir}.tmp-${process.pid}`;
  rmSync(tmpDir, { recursive: true, force: true });

  // readonly接続: 書き込み・DDL・migrationは構造的に不可能(実DB保全の根拠)
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  let inTx = false;
  try {
    // 読み取りトランザクション開始(readonly接続でも可)。最初のSELECTでスナップショットが確定する。
    sqlite.exec("BEGIN");
    inTx = true;
    const existingTables = new Set(
      (sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]).map((r) => r.name),
    );
    const missing = EXPORT_TABLES.filter((t) => !existingTables.has(t.name)).map((t) => t.name);
    if (missing.length > 0) {
      throw new Error(`エクスポート対象テーブルがDBにありません: ${missing.join(", ")}(migrationが未適用の可能性)`);
    }
    const schemaVersion = (sqlite.prepare("select coalesce(max(id), 0) v from schema_migrations").get() as { v: number }).v;
    const expected = Math.max(...MIGRATIONS.map((m) => m.id));

    mkdirSync(tmpDir, { recursive: true });
    const tables: ExportManifestTable[] = [];
    const fkChecked: ExportManifest["fkChecked"] = [];
    let totalRows = 0;

    for (const spec of EXPORT_TABLES) {
      const orderBy = spec.pk.map((c) => `"${c}"`).join(", ");
      const rows = sqlite.prepare(`select * from "${spec.name}" order by ${orderBy}`).all() as Record<string, unknown>[];
      const body = rows.map(stableRowJson).join("\n") + (rows.length > 0 ? "\n" : "");
      const file = `${spec.name}.jsonl`;
      writeFileSync(path.join(tmpDir, file), body, "utf8");
      tables.push({ name: spec.name, file, rows: rows.length, sha256: sha256Hex(body), bytes: Buffer.byteLength(body) });
      totalRows += rows.length;
      // export時点のFK整合をSQLite側で確認して記録(移行前の基準値)
      for (const fk of spec.fks) {
        const bad = (
          sqlite
            .prepare(
              `select count(*) n from "${spec.name}" c where c."${fk.column}" is not null and not exists (select 1 from "${fk.refTable}" p where p."${fk.refColumn}" = c."${fk.column}")`,
            )
            .get() as { n: number }
        ).n;
        if (bad > 0) {
          throw new Error(`FK不整合のためエクスポートを中止しました: ${spec.name}.${fk.column} → ${fk.refTable} に参照先のない行が${bad}件あります`);
        }
        const referenced = (
          sqlite.prepare(`select count(*) n from "${spec.name}" where "${fk.column}" is not null`).get() as { n: number }
        ).n;
        fkChecked.push({ table: spec.name, column: fk.column, refTable: fk.refTable, rows: referenced });
      }
      options.onTableExported?.(spec.name);
    }

    // 全読み取りが完了したのでスナップショットを閉じる(読み取りのみのため実DBは不変)
    sqlite.exec("COMMIT");
    inTx = false;

    const manifest: ExportManifest = {
      exportVersion: DB_EXPORT_VERSION,
      schemaVersion,
      expectedSchemaVersion: expected,
      createdAt: now.toISOString(),
      dbFile: path.basename(dbPath),
      totalRows,
      tables,
      fkChecked,
    };
    writeFileSync(path.join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    mkdirSync(path.dirname(outDir), { recursive: true });
    renameSync(tmpDir, outDir); // atomic: ここまで来て初めて正式成果物になる
    return { outDir, manifest };
  } catch (err) {
    if (inTx) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // 接続closeで解放されるため無視
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  } finally {
    sqlite.close();
  }
}

export interface DbExportVerifyReport {
  ok: boolean;
  dir: string;
  exportVersion: string | null;
  schemaVersion: number | null;
  tables: { name: string; rows: number; sha256Ok: boolean }[];
  problems: string[];
  warnings: string[];
}

/** manifest.json の厳密スキーマ(V5.4レビュー修正2: fail closed。未知キー・型崩れを拒否) */
const manifestTableEntrySchema = z
  .object({
    name: z.string().min(1),
    file: z.string().min(1),
    rows: z.number().int().min(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256は64桁の16進数が必要"),
    bytes: z.number().int().min(0),
  })
  .strict();

const manifestSchema = z
  .object({
    exportVersion: z.string(),
    schemaVersion: z.number().int().min(0),
    expectedSchemaVersion: z.number().int().min(0),
    createdAt: z.string(),
    dbFile: z.string(),
    totalRows: z.number().int().min(0),
    tables: z.array(manifestTableEntrySchema),
    fkChecked: z.array(
      z.object({ table: z.string(), column: z.string(), refTable: z.string(), rows: z.number().int().min(0) }).strict(),
    ),
  })
  .strict();

/**
 * エクスポート成果物の検証(fail closed)。
 * manifestはZodで厳密検証し、テーブル集合の完全一致・ファイル名規約(`<テーブル名>.jsonl`)・
 * パストラバーサル/シンボリックリンク拒否・SHA-256/bytes/件数/totalRows照合・重複PK・PK欠落・
 * FK整合・manifest外ファイルの混入をすべて問題(problem)として拒否する。
 */
export function verifyDbExport(dir: string): DbExportVerifyReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const report: DbExportVerifyReport = { ok: false, dir, exportVersion: null, schemaVersion: null, tables: [], problems, warnings };
  const resolvedDir = path.resolve(dir);

  const manifestPath = path.join(resolvedDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    problems.push("manifest.json がありません(不完全なエクスポート、またはディレクトリ指定誤り)");
    return report;
  }
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    problems.push("manifest.json をJSONとして読めません(破損の可能性)");
    return report;
  }
  const parsedManifest = manifestSchema.safeParse(manifestRaw);
  if (!parsedManifest.success) {
    // 攻撃的manifestの値をそのまま出力へ流さない(違反箇所とルールだけを示す)
    const issues = parsedManifest.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    problems.push(`manifest.json がスキーマ検証に失敗しました: ${issues.join(" / ")}`);
    return report;
  }
  const manifest = parsedManifest.data;
  report.exportVersion = manifest.exportVersion;
  report.schemaVersion = manifest.schemaVersion;

  if (manifest.exportVersion !== DB_EXPORT_VERSION) {
    problems.push(`exportVersionが一致しません(期待 ${DB_EXPORT_VERSION} / 実際 ${manifest.exportVersion})`);
  }
  if (manifest.schemaVersion !== manifest.expectedSchemaVersion) {
    problems.push(
      `manifest内のschema versionが不整合です(schemaVersion ${manifest.schemaVersion} / expectedSchemaVersion ${manifest.expectedSchemaVersion})。` +
        "migration未適用のDBからのエクスポートは使用できません",
    );
  }

  // テーブル集合の完全一致(欠落・未知・重複・file名規約違反をすべて拒否)
  const expectedNames = new Set(EXPORT_TABLES.map((t) => t.name));
  const seenNames = new Set<string>();
  const seenFiles = new Set<string>();
  for (const entry of manifest.tables) {
    if (seenNames.has(entry.name)) problems.push(`manifestにテーブル ${entry.name} が重複しています`);
    seenNames.add(entry.name);
    if (seenFiles.has(entry.file)) problems.push(`manifestにファイル名が重複しています: ${entry.file}`);
    seenFiles.add(entry.file);
    if (!expectedNames.has(entry.name)) problems.push(`manifestに未知のテーブルがあります: ${entry.name}`);
    // ファイル名規約: 必ず `<テーブル名>.jsonl`。絶対パス・「..」・サブディレクトリ・区切り文字は
    // この等価比較で構造的に排除される(テーブル名は既知集合のみ)。
    if (entry.file !== `${entry.name}.jsonl`) {
      problems.push(`ファイル名が規約(<テーブル名>.jsonl)に一致しません: テーブル ${entry.name}`);
    }
  }
  for (const spec of EXPORT_TABLES) {
    if (!seenNames.has(spec.name)) problems.push(`manifestにテーブル ${spec.name} がありません`);
  }
  const totalFromTables = manifest.tables.reduce((a, tEntry) => a + tEntry.rows, 0);
  if (totalFromTables !== manifest.totalRows) {
    problems.push(`totalRowsが一致しません(manifest ${manifest.totalRows} / 各テーブル合計 ${totalFromTables})`);
  }
  // manifestの構造が壊れている場合、以降のファイル読み取りは行わない(fail closed)
  if (problems.length > 0) return report;

  const parsedRows = new Map<string, Record<string, unknown>[]>();

  for (const entry of manifest.tables) {
    const filePath = path.resolve(resolvedDir, entry.file);
    // 多重防御: resolve後もエクスポートディレクトリ直下であること(file名規約検査に加えて確認)
    if (path.dirname(filePath) !== resolvedDir) {
      problems.push(`ファイルパスがエクスポートディレクトリ外を指しています: テーブル ${entry.name}`);
      continue;
    }
    if (!existsSync(filePath)) {
      problems.push(`ファイルがありません: ${entry.file}`);
      report.tables.push({ name: entry.name, rows: -1, sha256Ok: false });
      continue;
    }
    if (lstatSync(filePath).isSymbolicLink()) {
      problems.push(`シンボリックリンクは許可されません: ${entry.file}`);
      continue;
    }
    const buffer = readFileSync(filePath);
    if (buffer.byteLength !== entry.bytes) {
      problems.push(`ファイルサイズが一致しません: ${entry.file}(manifest ${entry.bytes} / 実ファイル ${buffer.byteLength} bytes)`);
    }
    const body = buffer.toString("utf8");
    const sha = sha256Hex(body);
    const sha256Ok = sha === entry.sha256;
    if (!sha256Ok) problems.push(`SHA-256が一致しません(改ざん・破損の可能性): ${entry.file}`);
    const lines = body.length === 0 ? [] : body.replace(/\n$/, "").split("\n").filter((l) => l.length > 0);
    if (lines.length !== entry.rows) {
      problems.push(`件数が一致しません: ${entry.name}(manifest ${entry.rows}行 / 実ファイル ${lines.length}行)`);
    }
    const spec = EXPORT_TABLES.find((t) => t.name === entry.name)!;
    const rows: Record<string, unknown>[] = [];
    const pkSet = new Set<string>();
    for (const [i, line] of lines.entries()) {
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        problems.push(`${entry.file} の${i + 1}行目がJSONとして読めません`);
        continue;
      }
      rows.push(row);
      // 主キー: 欠落・null・undefinedを拒否した上で重複を検査する
      const missingPk = spec.pk.filter((c) => !(c in row) || row[c] === null || row[c] === undefined);
      if (missingPk.length > 0) {
        problems.push(`主キー列が欠落しています: ${entry.name} の${i + 1}行目(${missingPk.join(",")})`);
        continue;
      }
      const key = spec.pk.map((c) => String(row[c])).join(PK_JOINER);
      if (pkSet.has(key)) {
        problems.push(`重複主キー: ${entry.name}(${spec.pk.join(",")}=${spec.pk.map((c) => String(row[c])).join(",")})`);
      }
      pkSet.add(key);
    }
    parsedRows.set(entry.name, rows);
    report.tables.push({ name: entry.name, rows: lines.length, sha256Ok });
  }

  // FK整合(エクスポートデータ内で完結して検査する)
  for (const spec of EXPORT_TABLES) {
    const rows = parsedRows.get(spec.name);
    if (!rows) continue;
    for (const fk of spec.fks) {
      const refRows = parsedRows.get(fk.refTable);
      if (!refRows) continue;
      const refValues = new Set(refRows.map((r) => String(r[fk.refColumn])));
      let bad = 0;
      for (const row of rows) {
        const v = row[fk.column];
        if (v === null || v === undefined) continue;
        if (!refValues.has(String(v))) bad += 1;
      }
      if (bad > 0) problems.push(`FK不整合: ${spec.name}.${fk.column} → ${fk.refTable} で参照先のない行が${bad}件`);
    }
  }

  // manifest外の余分なファイルは混入として拒否する(import境界のfail closed)
  const known = new Set([...manifest.tables.map((tEntry) => tEntry.file), "manifest.json"]);
  for (const f of readdirSync(resolvedDir)) {
    if (!known.has(f)) problems.push(`manifestに記載のないファイルがあります(混入の可能性): ${f}`);
  }

  report.ok = problems.length === 0;
  return report;
}
