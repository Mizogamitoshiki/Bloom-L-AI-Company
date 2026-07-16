"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { MeetingView } from "@adapters/db/views";
import { AppShell, PageHeader } from "@/components/AppShell";

function Section({ title, items }: { title: string; items: string[] }): JSX.Element | null {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <h3 style={{ fontSize: 13, margin: "0 0 4px", color: "var(--color-text-muted)" }}>{title}</h3>
      <ul style={{ fontSize: 13, margin: 0, paddingLeft: 18 }}>
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    </div>
  );
}

/** S-09 議事録。週次/月次会議の事実・観察・提案・決定・次週計画を閲覧(作成は weekly-review skill 経由) */
export default function MeetingsPage(): JSX.Element {
  const [items, setItems] = useState<MeetingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setItems(json as MeetingView[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell current="/meetings" title="会議・議事録">
      <PageHeader
        title="会議・議事録"
        subtitle="週次/月次会議の議事録。作成は Claude Code で /weekly-review を実行したときのみ(自動起動しません)。"
      />
      {error ? <p className="error-box" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}
      {items && items.length === 0 ? (
        <div className="card"><div className="card__body">
          <p style={{ margin: 0, fontSize: 14 }}>まだ議事録はありません。Claude Code で <code>/weekly-review</code> を実行すると、湊・蓮・葵が集計・提案・整理し、代表者承認済みの決定が記録されます。</p>
        </div></div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {items?.map((m) => (
          <section key={m.id} className="card">
            <div className="card__header">
              <h2 className="card__title">{m.kind === "weekly" ? "週次会議" : "月次会議"} — {m.heldOn}</h2>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-muted)" }}>
                {m.periodStart}〜{m.periodEnd}
              </span>
            </div>
            <div className="card__body">
              {m.participants.length > 0 ? (
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>参加: {m.participants.join(" / ")}</p>
              ) : null}
              {m.minutes ? (
                <>
                  <Section title="議題" items={m.minutes.agenda} />
                  <Section title="事実(DB集計)" items={m.minutes.facts} />
                  <Section title="観察" items={m.minutes.observations} />
                  <Section title="提案(改善仮説)" items={m.minutes.proposals} />
                  <Section title="決定(代表者承認済み)" items={m.minutes.decisions} />
                  <Section title="代表者アクション" items={m.minutes.ownerActions} />
                  <Section title="次週計画" items={m.minutes.nextWeekPlan} />
                </>
              ) : (
                <Section title="決定" items={m.decisions} />
              )}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
