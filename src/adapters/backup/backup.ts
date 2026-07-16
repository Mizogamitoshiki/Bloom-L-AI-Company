/**
 * バックアップ・復旧(V4-E, AC-30)。
 * - backup: 一時ディレクトリで DB/workspace/manifest を完成・検証してから置換する
 * - restore: 全checksum検証 → 一時領域でDB検証 → DB/workspaceをロールバック可能な手順で置換する
 */
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
  renameSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  cpSync,
} from "node:fs";
import path from "node:path";
import { findRepoRoot, workspaceRoot } from "../root";
import { openDb, defaultDbPath } from "../db/client";
import type { Db } from "../db/client";

/** doctor検証の型(views.doctorScan を CLI から注入。backup→views の循環依存を避ける)。 */
export type VerifyFn = (db: Db) => { level: string; message: string }[];

export const BACKUP_SCHEMA_VERSION = "backup-v2";
const KEEP_GENERATIONS = 14;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRE_RESTORE_RE = /^\.pre-restore-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

function backupsRoot(): string {
  return path.resolve(process.env.BLOOM_BACKUP_PATH ?? path.join(findRepoRoot(), "data", "backups"));
}

/** YYYY-MM-DDの形だけでなく、実在する暦日であることも確認する。 */
export function assertBusinessDate(value: string, label = "日付"): string {
  if (!DATE_RE.test(value)) throw new Error(`${label}はYYYY-MM-DD形式で指定してください`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}が実在する日付ではありません: ${value}`);
  }
  return value;
}

function assertBackupRef(value: string): string {
  if (DATE_RE.test(value)) return assertBusinessDate(value, "復元元");
  if (PRE_RESTORE_RE.test(value)) return value;
  throw new Error("復元元はYYYY-MM-DDまたはbackup-listに表示された復元前バックアップ名で指定してください");
}

function assertInternalLabel(value: string): string {
  if (!PRE_RESTORE_RE.test(value)) throw new Error(`内部バックアップ名が不正です: ${value}`);
  return value;
}

/** root配下から外れるパスを構築できないことを二重に保証する。 */
function childPath(root: string, name: string): string {
  if (path.isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    throw new Error(`バックアップ名にパスを指定できません: ${name}`);
  }
  const candidate = path.resolve(root, name);
  const rel = path.relative(root, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`バックアップ領域外のパスは使用できません: ${name}`);
  }
  return candidate;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export interface BackupFileEntry {
  path: string;
  bytes: number;
  /** backup-v1との読み取り互換のためoptional。v2では必須。 */
  sha256?: string;
}

export interface BackupManifest {
  schemaVersion: string;
  createdAt: string;
  date: string;
  migrations: { id: number; name: string }[];
  dbSha256: string;
  dbBytes: number;
  workspaceIncluded: boolean;
  files: BackupFileEntry[];
}

function collectFiles(base: string, rel = ""): BackupFileEntry[] {
  const files: BackupFileEntry[] = [];
  for (const name of readdirSync(base).sort()) {
    const abs = path.join(base, name);
    const childRel = path.join(rel, name);
    const st = statSync(abs);
    if (st.isDirectory()) files.push(...collectFiles(abs, childRel));
    else files.push({ path: childRel, bytes: st.size, sha256: sha256(abs) });
  }
  return files;
}

function validateBackupDirectory(dir: string): BackupManifest {
  const manifestPath = path.join(dir, "manifest.json");
  const dbFile = path.join(dir, "company.db");
  if (!existsSync(manifestPath) || !existsSync(dbFile)) throw new Error("manifest.jsonまたはcompany.dbがありません");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  if (manifest.schemaVersion !== "backup-v1" && manifest.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(`未対応のバックアップ形式です: ${manifest.schemaVersion}`);
  }
  if (statSync(dbFile).size !== manifest.dbBytes || sha256(dbFile) !== manifest.dbSha256) {
    throw new Error("company.dbのSHA-256またはサイズが一致しません");
  }
  if (manifest.workspaceIncluded && !existsSync(path.join(dir, "workspace"))) {
    throw new Error("workspaceIncluded=trueですがworkspaceがありません");
  }
  if (manifest.schemaVersion === BACKUP_SCHEMA_VERSION) {
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("ファイル一覧がありません");
    const actualPaths = collectFiles(dir)
      .map((entry) => entry.path)
      .filter((entryPath) => entryPath !== "manifest.json")
      .sort();
    const declaredPaths = manifest.files.map((entry) => entry.path).sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) {
      throw new Error("manifestのファイル一覧と実際のバックアップ内容が一致しません");
    }
    for (const entry of manifest.files) {
      if (!entry.path || path.isAbsolute(entry.path) || entry.path.split(path.sep).includes("..")) {
        throw new Error(`manifest内のファイルパスが不正です: ${entry.path}`);
      }
      const abs = path.resolve(dir, entry.path);
      const rel = path.relative(dir, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel) || !existsSync(abs)) {
        throw new Error(`バックアップファイルが欠損しています: ${entry.path}`);
      }
      const st = statSync(abs);
      if (!st.isFile() || st.size !== entry.bytes || !entry.sha256 || sha256(abs) !== entry.sha256) {
        throw new Error(`バックアップファイルのSHA-256またはサイズが一致しません: ${entry.path}`);
      }
    }
  }
  return manifest;
}

/** 完成済みディレクトリを既存世代へ安全に差し替える。失敗時は旧世代へ戻す。 */
function replaceDirectory(staged: string, finalDir: string): void {
  const old = `${finalDir}.old-${randomUUID()}`;
  const hadOld = existsSync(finalDir);
  if (hadOld) renameSync(finalDir, old);
  try {
    renameSync(staged, finalDir);
  } catch (err) {
    if (hadOld && existsSync(old)) renameSync(old, finalDir);
    throw err;
  }
  if (hadOld) rmSync(old, { recursive: true, force: true });
}

/** 整合スナップショット + workspace + manifest を完成後に data/backups/<date>/ へ配置する。 */
export function createBackup(date: string, opts: { dbPath?: string; label?: string } = {}): { dir: string; manifest: BackupManifest } {
  assertBusinessDate(date);
  const dbPath = opts.dbPath ?? defaultDbPath();
  if (!existsSync(dbPath)) throw new Error(`DBが見つかりません: ${dbPath}`);
  const root = backupsRoot();
  mkdirSync(root, { recursive: true });
  const dirName = opts.label ? assertInternalLabel(opts.label) : date;
  const dir = childPath(root, dirName);
  const staged = childPath(root, `.pre-restore-${date}-build-${randomUUID().toLowerCase()}`);
  mkdirSync(staged, { recursive: true });

  let manifest: BackupManifest;
  try {
    const src = new Database(dbPath, { readonly: true });
    let migrations: { id: number; name: string }[];
    try {
      migrations = src.prepare("select id, name from schema_migrations order by id").all() as { id: number; name: string }[];
      const destDb = path.join(staged, "company.db");
      src.exec(`VACUUM INTO '${destDb.replace(/'/g, "''")}'`);
    } finally {
      src.close();
    }

    const ws = workspaceRoot();
    let workspaceIncluded = false;
    if (existsSync(ws)) {
      cpSync(ws, path.join(staged, "workspace"), { recursive: true });
      workspaceIncluded = true;
    }

    const destDb = path.join(staged, "company.db");
    manifest = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      date,
      migrations,
      dbSha256: sha256(destDb),
      dbBytes: statSync(destDb).size,
      workspaceIncluded,
      files: collectFiles(staged),
    };
    writeFileSync(path.join(staged, "manifest.json"), JSON.stringify(manifest, null, 2));
    validateBackupDirectory(staged);
    replaceDirectory(staged, dir);
  } catch (err) {
    rmSync(staged, { recursive: true, force: true });
    throw err;
  }

  rotate();
  return { dir, manifest };
}

/** 日次14世代を保持。復元前バックアップは自動削除しない。 */
function rotate(): void {
  const root = backupsRoot();
  if (!existsSync(root)) return;
  const dated = readdirSync(root).filter((d) => DATE_RE.test(d)).sort().reverse();
  for (const old of dated.slice(KEEP_GENERATIONS)) {
    rmSync(childPath(root, old), { recursive: true, force: true });
  }
}

export interface BackupListItem {
  date: string;
  createdAt: string | null;
  dbBytes: number | null;
  migrations: number | null;
  valid: boolean;
}

export function listBackups(): BackupListItem[] {
  const root = backupsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => (DATE_RE.test(d) || PRE_RESTORE_RE.test(d)) && existsSync(path.join(root, d, "manifest.json")))
    .map((d) => {
      try {
        const m = validateBackupDirectory(childPath(root, d));
        return { date: d, createdAt: m.createdAt, dbBytes: m.dbBytes, migrations: m.migrations.length, valid: true };
      } catch {
        return { date: d, createdAt: null, dbBytes: null, migrations: null, valid: false };
      }
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface RestoreResult {
  restoredFrom: string;
  preRestoreBackup: string;
  workspaceRestored: boolean;
}

/** DBとworkspaceを置換し、途中失敗時は両方を旧状態へ戻す。 */
function replaceRestoredPair(dbPath: string, stagedDb: string, stagedWorkspace: string | null, replaceWorkspace: boolean): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const token = randomUUID();
  const oldDb = `${dbPath}.restore-old-${token}`;
  const ws = workspaceRoot();
  const oldWs = `${ws}.restore-old-${token}`;
  const hadDb = existsSync(dbPath);
  const hadWs = existsSync(ws);
  let dbPlaced = false;
  let wsPlaced = false;
  try {
    for (const sfx of ["-wal", "-shm"]) rmSync(dbPath + sfx, { force: true });
    if (hadDb) renameSync(dbPath, oldDb);
    renameSync(stagedDb, dbPath);
    dbPlaced = true;
    if (replaceWorkspace) {
      mkdirSync(path.dirname(ws), { recursive: true });
      if (hadWs) renameSync(ws, oldWs);
      if (stagedWorkspace) {
        renameSync(stagedWorkspace, ws);
        wsPlaced = true;
      }
    }
  } catch (err) {
    if (wsPlaced && existsSync(ws)) rmSync(ws, { recursive: true, force: true });
    if (hadWs && existsSync(oldWs)) renameSync(oldWs, ws);
    if (dbPlaced && existsSync(dbPath)) rmSync(dbPath, { force: true });
    if (hadDb && existsSync(oldDb)) renameSync(oldDb, dbPath);
    throw err;
  }
  if (hadDb) rmSync(oldDb, { force: true });
  if (replaceWorkspace && hadWs) rmSync(oldWs, { recursive: true, force: true });
}

/**
 * 復元。checksum検証 → 復元前backup → 一時DB検証 → DB/workspace置換。
 * closeCurrentはファイル置換直前に呼ぶ。
 */
export function restoreBackup(
  fromDate: string,
  opts: { dbPath?: string; closeCurrent?: () => void; verify?: VerifyFn } = {},
): RestoreResult {
  const ref = assertBackupRef(fromDate);
  const dbPath = opts.dbPath ?? defaultDbPath();
  const root = backupsRoot();
  const dir = childPath(root, ref);
  if (!existsSync(dir)) throw new Error(`バックアップが見つかりません: ${ref}。pnpm company backup-list で確認してください`);
  let manifest: BackupManifest;
  try {
    manifest = validateBackupDirectory(dir);
  } catch (err) {
    throw new Error(`バックアップが破損または改ざんされています: ${ref} — ${err instanceof Error ? err.message : String(err)}。復元を中止しました`);
  }

  let preRestore = "";
  if (existsSync(dbPath)) {
    const label = `.pre-restore-${manifest.date}-${randomUUID().toLowerCase()}`;
    createBackup(manifest.date, { dbPath, label });
    preRestore = label;
  }

  mkdirSync(root, { recursive: true });
  const token = randomUUID();
  const tmpDb = path.join(root, `.restore-verify-${token}.db`);
  const stagedDb = path.join(path.dirname(dbPath), `.company-restore-${token}.db`);
  const backupWorkspace = path.join(dir, "workspace");
  const shouldRestoreWorkspace = manifest.workspaceIncluded && existsSync(backupWorkspace);
  // v2は「workspaceが存在しなかった」という状態も復元する。v1は従来互換で、同梱時のみ置換する。
  const replaceWorkspace = manifest.schemaVersion === BACKUP_SCHEMA_VERSION || shouldRestoreWorkspace;
  const ws = workspaceRoot();
  const stagedWorkspace = shouldRestoreWorkspace ? path.join(path.dirname(ws), `.workspace-restore-${token}`) : null;
  copyFileSync(path.join(dir, "company.db"), tmpDb);
  try {
    const test = openDb(tmpDb);
    try {
      const violations = (test.sqlite.pragma("foreign_key_check") as unknown[]).length;
      if (violations > 0) throw new Error(`復元候補に外部キー違反が${violations}件あります`);
      const errors = (opts.verify?.(test.db) ?? []).filter((f) => f.level === "error");
      if (errors.length > 0) throw new Error(`復元候補にdoctorエラーが${errors.length}件あります: ${errors[0]!.message}`);
    } finally {
      test.sqlite.close();
    }

    mkdirSync(path.dirname(stagedDb), { recursive: true });
    copyFileSync(tmpDb, stagedDb);
    if (stagedWorkspace) cpSync(backupWorkspace, stagedWorkspace, { recursive: true });
    opts.closeCurrent?.();
    replaceRestoredPair(dbPath, stagedDb, stagedWorkspace, replaceWorkspace);
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : String(err)}。復元を中止しました(現DB/workspaceは復元前バックアップ ${preRestore || "なし"} から回収可能です)`);
  } finally {
    rmSync(tmpDb, { force: true });
    rmSync(stagedDb, { force: true });
    if (stagedWorkspace) rmSync(stagedWorkspace, { recursive: true, force: true });
  }

  return { restoredFrom: ref, preRestoreBackup: preRestore, workspaceRestored: replaceWorkspace };
}
