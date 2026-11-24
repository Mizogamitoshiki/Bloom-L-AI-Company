"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { EmployeesAdminView, EmployeeAdminItem } from "@adapters/db/views";
import { AppShell, PageHeader } from "@/components/AppShell";
import { PixelAvatar } from "@/components/PixelAvatar";
import { StatusBadge } from "@/components/StatusBadge";

const MODEL_LABEL: Record<string, string> = { light: "軽量モデル", standard: "標準モデル", heavy: "高性能モデル" };
const TASK_STATUS_LABEL: Record<string, string> = {
  queued: "待機", running: "実行中", done: "完了", failed: "失敗", cancelled: "中止",
};

function fmtDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function fmtWork(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min}分` : `${Math.floor(min / 60)}時間${min % 60}分`;
}

function ListSection({ title, items }: { title: string; items: string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 style={{ fontSize: 12, margin: "0 0 4px", color: "var(--color-text-muted)" }}>{title}</h4>
      <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}

function EmployeeCard({ emp }: { emp: EmployeeAdminItem }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <div className="card__body" style={{ display: "grid", gap: 10 }}>
        {/* プロフィール行 */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <PixelAvatar hue={emp.spriteHue} seed={emp.id} />
          <div style={{ display: "grid", gap: 2, minWidth: 160 }}>
            <strong style={{ fontSize: 15 }}>{emp.name}</strong>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{emp.role}</span>
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              {MODEL_LABEL[emp.modelProfile] ?? emp.modelProfile} ・ agent: {emp.agentRef}
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {!emp.activeInMvp ? (
              <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "var(--color-surface-muted)", color: "var(--color-text-muted)" }}>
                第2段階で稼働予定
              </span>
            ) : null}
            <StatusBadge state={emp.display.state} />
          </div>
        </div>
        {emp.currentTaskTitle ? (
          <p style={{ fontSize: 12.5, margin: 0 }}>いまの仕事: {emp.currentTaskTitle}</p>
        ) : null}
        {emp.persona ? (
          <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-text)" }}>{emp.persona.purpose}</p>
        ) : null}

        {/* 実績サマリー */}
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, fontSize: 12, margin: 0 }}>
          {[
            ["完了タスク", `${emp.stats.tasksDone}件`],
            ["失敗", `${emp.stats.tasksFailed}件`],
            ["成果物", `${emp.stats.artifacts}件`],
            ["累計作業時間", fmtWork(emp.stats.wallSeconds)],
            ["最終稼働", fmtDateTime(emp.stats.lastActivityAt)],
          ].map(([label, value]) => (
            <div key={label} style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
              <dt style={{ color: "var(--color-text-muted)" }}>{label}</dt>
              <dd style={{ margin: 0, fontWeight: 700 }}>{value}</dd>
            </div>
          ))}
        </dl>

        <button type="button" className="btn btn--secondary btn--sm" style={{ justifySelf: "start" }} onClick={() => setOpen((v) => !v)}>
          {open ? "詳細を閉じる" : "詳細(性格・職務・権限・最近の仕事)"}
        </button>

        {open ? (
          <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            {emp.persona ? (
              <>
                <p style={{ fontSize: 12.5, margin: 0 }}><strong>性格:</strong> {emp.persona.personality}</p>
                <ListSection title="受け取るもの(入力)" items={emp.persona.inputs} />
                <ListSection title="つくるもの(出力)" items={emp.persona.outputs} />
                <ListSection title="使えるツール(最小権限)" items={emp.persona.tools} />
                <ListSection title="禁止事項" items={emp.persona.prohibitions} />
                <p style={{ fontSize: 12.5, margin: 0 }}><strong>失敗したとき:</strong> {emp.persona.onFailure}</p>
              </>
            ) : (
              <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-text-muted)" }}>ペルソナ定義がありません。</p>
            )}
            <div>
              <h4 style={{ fontSize: 12, margin: "0 0 4px", color: "var(--color-text-muted)" }}>最近のタスク(最新5件)</h4>
              {emp.recentTasks.length === 0 ? (
                <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-text-muted)" }}>まだタスクの記録がありません。</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
                  {emp.recentTasks.map((task) => (
                    <li key={task.id} style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, color: task.status === "failed" ? "var(--color-danger)" : task.status === "done" ? "var(--color-success)" : "var(--color-text-muted)" }}>
                        {TASK_STATUS_LABEL[task.status] ?? task.status}
                      </span>
                      <span>{task.title}</span>
                      <span style={{ color: "var(--color-text-muted)", fontSize: 11.5 }}>{task.runDate}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** V7: AI社員管理。プロフィール・ペルソナ(職務/権限/禁止事項)・稼働状態・実績を部署別に一覧する */
export default function EmployeesPage(): JSX.Element {
  const [view, setView] = useState<EmployeesAdminView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/employees", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setView(json as EmployeesAdminView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const working = view?.employees.filter((e) => ["researching", "creating", "meeting", "qa"].includes(e.display.state)).length ?? 0;

  return (
    <AppShell current="/employees" title="AI社員管理">
      <PageHeader
        title="AI社員管理"
        subtitle={view ? `全${view.employees.length}名(稼働中${working}名)。各社員の職務・権限・実績・現在の状態を確認できます。30秒ごとに自動更新。` : "読み込み中…"}
      />
      {error ? <p className="error-box" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}

      {view?.departments.map((dept) => {
        const members = view.employees.filter((e) => e.departmentId === dept.id);
        if (members.length === 0) return null;
        return (
          <div key={dept.id} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 14, margin: "0 0 10px", display: "flex", gap: 8, alignItems: "center" }}>
              {dept.name}
              <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--color-text-muted)" }}>{members.length}名</span>
              {dept.status !== "active" ? (
                <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--color-text-muted)" }}>({dept.unlockNote ?? "未稼働"})</span>
              ) : null}
            </h2>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
              {members.map((emp) => <EmployeeCard key={emp.id} emp={emp} />)}
            </div>
          </div>
        );
      })}
    </AppShell>
  );
}
