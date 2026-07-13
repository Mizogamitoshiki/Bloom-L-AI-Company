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
