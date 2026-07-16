import { randomBytes } from "node:crypto";

const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32

/** ULID(時系列ソート可能ID)。クラウド移行時のテナント分離を見据えたID設計(docs/13) */
export function ulid(now: number = Date.now()): string {
  let time = now;
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = ENC[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const rand = randomBytes(16);
  let randPart = "";
  for (let i = 0; i < 16; i++) {
    randPart += ENC[(rand[i] as number) % 32];
  }
  return timePart + randPart;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** ローカル日付(YYYY-MM-DD、Asia/Tokyo想定のローカルタイム) */
export function todayLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Asia/Tokyo基準の業務日(YYYY-MM-DD)。ホストのタイムゾーンに依存しない(JST=UTC+9固定・DSTなし)。
 * 日次上限(usage / startedイベント / heavy昇格 / research fetch / 新規投稿数)の判定はすべてこれを使う
 * (V3再レビューP1-2: nowIso()のUTC日時とtodayLocal()を直接比較しない)。
 */
export function businessDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 保存済みのUTC ISO文字列をAsia/Tokyo業務日へ変換する */
export function businessDateFromIso(iso: string): string {
  return businessDate(new Date(iso));
}

/** SQLite側でtsカラム(UTC ISO)をJST業務日として比較するための式(date(ts, '+9 hours')) */
export const SQL_JST_DATE = "date(ts, '+9 hours')";

/** 業務日(YYYY-MM-DD)にn日加算した業務日を返す(UTCの日付演算で安全) */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = Date.UTC(y!, m! - 1, d!);
  return new Date(base + n * 86_400_000).toISOString().slice(0, 10);
}

/** dateを含む週(月曜〜日曜)の [開始, 終了] 業務日 */
export function weekRange(dateStr: string): { start: string; end: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7;
  const start = addDays(dateStr, -backToMonday);
  return { start, end: addDays(start, 6) };
}

/** dateを含む月の [初日, 末日] 業務日 */
export function monthRange(dateStr: string): { start: string; end: string } {
  const [y, m] = dateStr.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { start, end: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}
