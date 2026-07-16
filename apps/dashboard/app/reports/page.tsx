"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { ReportArtifact } from "@core/schemas";
import { AppShell, PageHeader } from "@/components/AppShell";

type Kind = "daily" | "weekly" | "monthly";

const STAT_LABEL: Record<string, string> = {
  postsCreated: "作成投稿",
  published: "公開数",
  tasksDone: "完了タスク",
  tasksFailed: "失敗タスク",
  tasksTotal: "タスク総数",
  awaitingApproval: "承認待ち",
  blockedRights: "権利確認待ち",
  approved: "承認",
  rejected: "却下",
  revisions: "修正依頼",
  approvalRatePct: "承認率(%)",
  failRatePct: "失敗率(%)",
  estOutputChars: "推定出力文字数(推定)",
  usageRecords: "利用記録数",
  heavyEscalations: "heavy昇格",
  agentLaunches: "エージェント起動",
  snsMetricsEntered: "SNS指標入力済み",
};

/** レポート(V3-G日報 + V4週報/月報)。DBの事実のみ。推定値は「推定」と明示 */
export default function ReportsPage(): JSX.Element {
  const [kind, setKind] = useState<Kind>("daily");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [report, setReport] = useState<ReportArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports?kind=${kind}&date=${date}`, { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setReport(json as ReportArtifact);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [kind, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = kind === "daily" ? "日報" : kind === "weekly" ? "週報" : "月報";

  return (
    <AppShell current="/reports" title="レポート">
      <PageHeader
        title="レポート"
        subtitle="DBの事実のみを決定的に集計(推定値は「推定」と明示)。投稿10本未満は統計的断定をしません。"
        actions={
          <>
            <div role="tablist" aria-label="レポート種別" style={{ display: "flex", gap: 4 }}>
              {(["daily", "weekly", "monthly"] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  className={`btn btn--sm ${kind === k ? "btn--primary" : "btn--secondary"}`}
                  onClick={() => setKind(k)}
                >
                  {k === "daily" ? "日報" : k === "weekly" ? "週報" : "月報"}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 13 }}>
              基準日 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ font: "inherit", padding: 4 }} />
            </label>
          </>
        }
      />
      {error ? <p className="error-box" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}
      {report ? (
        <div style={{ maxWidth: 920, display: "grid", gap: 14 }}>
          <section className="card">
            <div className="card__header">
              <h2 className="card__title">
                {title}
                {report.periodStart ? `(${report.periodStart}〜${report.periodEnd})` : `(${report.date})`}
              </h2>
            </div>
            <div className="card__body">
              {report.dataNote ? (
                <p style={{ fontSize: 13, background: "var(--color-warning-soft)", padding: 8, borderRadius: 6, color: "#6d4600", margin: "0 0 10px" }}>
                  {report.dataNote}
                </p>
              ) : null}
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, fontSize: 13, margin: 0 }}>
                {Object.entries(report.stats).map(([k, v]) => (
                  <div key={k} style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
                    <dt style={{ color: "var(--color-text-muted)" }}>{STAT_LABEL[k] ?? k}</dt>
                    <dd style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{v === -1 ? "—" : v.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
          <section className="card">
            <div className="card__header"><h2 className="card__title">記録</h2></div>
            <div className="card__body">
              <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
                {report.lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          </section>
          {report.ownerActions.length > 0 ? (
            <section className="card" style={{ borderColor: "var(--color-warning)" }}>
              <div className="card__header"><h2 className="card__title">代表者にお願いしたい作業</h2></div>
              <div className="card__body">
                <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
                  {report.ownerActions.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            </section>
          ) : null}
          {report.tomorrow.length > 0 ? (
            <section className="card">
              <div className="card__header"><h2 className="card__title">翌日の推奨作業</h2></div>
              <div className="card__body">
                <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
                  {report.tomorrow.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      ) : (
        <p>読み込み中…</p>
      )}
    </AppShell>
  );
}
