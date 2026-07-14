"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { ReportArtifact } from "@core/schemas";
import { AppShell, PageHeader } from "@/components/AppShell";

/** 日報(V3-G)。DBの事実のみ。推定値は「推定」と明示 */
export default function ReportsPage(): JSX.Element {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [report, setReport] = useState<ReportArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports?date=${date}`, { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setReport(json as ReportArtifact);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const STAT_LABEL: Record<string, string> = {
    postsCreated: "作成投稿",
    tasksDone: "完了タスク",
    tasksFailed: "失敗タスク",
    awaitingApproval: "承認待ち",
    blockedRights: "権利確認待ち",
    estOutputChars: "推定出力文字数(推定)",
    usageRecords: "利用記録数",
  };

  return (
    <AppShell current="/reports" title="日報">
      <PageHeader title="日報" subtitle="DBの事実のみを集計(推定値は「推定」と明示)。" />
      {error ? <p className="error-box" style={{ margin: 16 }} role="alert">{error}</p> : null}
      {report ? (
        <div style={{ padding: 16, maxWidth: 900, margin: "0 auto", display: "grid", gap: 16 }}>
          <section style={{ background: "#fff", border: "2px solid var(--color-wall)", borderRadius: 8, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>{report.date} のサマリー</h2>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, fontSize: 13 }}>
              {Object.entries(report.stats).map(([k, v]) => (
                <div key={k} style={{ background: "var(--color-surface)", padding: 8, borderRadius: 6 }}>
                  <dt style={{ color: "var(--color-ink-muted)" }}>{STAT_LABEL[k] ?? k}</dt>
                  <dd style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{v.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section style={{ background: "#fff", border: "2px solid var(--color-wall)", borderRadius: 8, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>本日の記録</h2>
            <ul style={{ fontSize: 13, paddingLeft: 18 }}>
              {report.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </section>
          <section style={{ background: "#fff8e8", border: "2px solid var(--color-warning)", borderRadius: 8, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>代表者にお願いしたい作業</h2>
            <ul style={{ fontSize: 13, paddingLeft: 18 }}>
              {report.ownerActions.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </section>
          <section style={{ background: "#fff", border: "2px solid var(--color-wall)", borderRadius: 8, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>翌日の推奨作業</h2>
            <ul style={{ fontSize: 13, paddingLeft: 18 }}>
              {report.tomorrow.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : (
        <p style={{ padding: 16 }}>読み込み中…</p>
      )}
    </AppShell>
  );
}
