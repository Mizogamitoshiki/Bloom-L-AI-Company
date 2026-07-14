"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { CalendarView } from "@adapters/db/views";
import { AppShell, PageHeader } from "@/components/AppShell";

const PILLAR_COLOR: Record<string, string> = {
  "1": "#2b5f8a", "2": "#6a5acd", "3": "#2f6f4f", "4": "#8a6d3b", "5": "#a0522d", "6": "#b3402f",
};
const PILLAR_SHORT: Record<string, string> = {
  "1": "①", "2": "②", "3": "③", "4": "④", "5": "⑤", "6": "⑥",
};
const STATUS_SHORT: Record<string, string> = {
  idea: "企画", drafting: "制作", qa_review: "QA", awaiting_approval: "承認待", revision_requested: "修正",
  approved: "承認済", rejected: "却下", exported: "書出済", published: "投稿済", measured: "計測済",
};

function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** S-05 投稿カレンダー(V3-F)。表示はplannedDate起点。自動投稿・予約投稿は行わない */
export default function CalendarPage(): JSX.Element {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<CalendarView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/calendar?month=${month}`, { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setView(json as CalendarView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reschedule(postId: string, current: string): Promise<void> {
    // キーボード操作可能なプロンプトベースの日付変更(D&Dは必須ではない)
    const next = window.prompt("新しい予定日(YYYY-MM-DD)", current);
    if (!next || next === current) return;
    try {
      const res = await fetch(`/api/posts/${postId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plannedDate: next }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "変更に失敗しました");
      setNotice(`予定日を${next}に変更しました(監査ログに記録)`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const byDate = new Map<string, CalendarView["posts"]>();
  for (const p of view?.posts ?? []) {
    const arr = byDate.get(p.plannedDate) ?? [];
    arr.push(p);
    byDate.set(p.plannedDate, arr);
  }

  return (
    <AppShell current="/calendar" title="投稿カレンダー">
      <PageHeader title="投稿カレンダー" subtitle="plannedDate基準の予定表。自動投稿・予約投稿は行いません。" />
      {notice ? <p role="status" style={{ margin: 16, padding: 8, background: "#eef7ee", border: "1.5px solid var(--color-success)", borderRadius: 4 }}>{notice}</p> : null}
      {error ? <p className="error-box" style={{ margin: 16 }} role="alert">{error}</p> : null}
      {view ? (
        <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
          <p style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>
            初期目標: 週3本 / 同日上限: {view.dailyCap}本(超過日は⚠表示)。凡例:{" "}
            {Object.entries(PILLAR_SHORT).map(([k, v]) => (
              <span key={k} style={{ marginRight: 8 }}>
                <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, background: PILLAR_COLOR[k], marginRight: 2 }} />
                {v}
              </span>
            ))}
            ※柱は色+番号で表示(色だけに依存しない)
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {monthDays(view.month).map((date) => {
              const posts = byDate.get(date) ?? [];
              const over = posts.length > view.dailyCap;
              return (
                <section key={date} aria-label={date} style={{ border: "1px solid var(--color-wall)", borderRadius: 6, background: "#fff", padding: 8, minHeight: 90 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {date.slice(8)}日 {over ? <span style={{ color: "var(--color-danger)" }}>⚠上限超</span> : null}
                    <span style={{ color: "var(--color-ink-muted)", fontWeight: 400 }}> {posts.length}/{view.dailyCap}</span>
                  </div>
                  {posts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void reschedule(p.id, p.plannedDate)}
                      aria-label={`「${p.title}」(${STATUS_SHORT[p.status] ?? p.status})の予定日を変更`}
                      style={{
                        display: "block", width: "100%", textAlign: "left", fontSize: 11, marginTop: 4,
                        border: `2px solid ${PILLAR_COLOR[p.pillar] ?? "#888"}`, borderRadius: 4, background: "#fff", padding: 4, minHeight: 34,
                      }}
                    >
                      <strong>{PILLAR_SHORT[p.pillar]} {STATUS_SHORT[p.status] ?? p.status}</strong>
                      {p.rightsState === "blocked_rights" ? " ⚠権利" : ""}
                      <br />
                      {p.title.slice(0, 18)}
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: "var(--color-ink-muted)", marginTop: 12 }}>
            投稿カードをクリック(Enter)で予定日を変更できます。Instagramへの自動投稿・予約投稿は行いません(投稿は代表者の手動操作)。
          </p>
        </div>
      ) : (
        <p style={{ padding: 16 }}>読み込み中…</p>
      )}
    </AppShell>
  );
}
