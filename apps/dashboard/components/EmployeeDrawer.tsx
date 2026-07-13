"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { EmployeeDetailView } from "@adapters/db/store";
import { StatusBadge } from "./StatusBadge";

function fmt(ts: string | null | undefined): string {
  return ts ? new Date(ts).toLocaleString("ja-JP") : "—";
}

/** 社員詳細パネル(docs/10 S-02)。§13必須項目をすべて表示する */
export function EmployeeDrawer({ employeeId, onClose }: { employeeId: string; onClose: () => void }): JSX.Element {
  const [detail, setDetail] = useState<EmployeeDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees/${employeeId}`, { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setDetail(json as EmployeeDetailView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, onClose]);

  async function taskAction(taskId: string, action: "cancel" | "resume"): Promise<void> {
    setActionError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "操作に失敗しました");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="AI社員の詳細">
        <button type="button" className="btn-secondary" onClick={onClose} style={{ float: "right" }}>
          閉じる(Esc)
        </button>
        {error ? <p className="error-box">{error}</p> : null}
        {!detail && !error ? <p>読み込み中…</p> : null}
        {detail ? (
          <>
            <h2>
              {detail.employee.name} <small style={{ fontWeight: 400 }}>{detail.employee.role}</small>
            </h2>
            <StatusBadge state={detail.display.state} />
            <p style={{ fontSize: 13, marginTop: 6 }}>{detail.display.reason}</p>

            <div className="section">
              <h3>現在のタスク</h3>
              {detail.currentTask ? (
                <>
                  <dl>
                    <dt>タスク</dt>
                    <dd>{detail.currentTask.title}</dd>
                    <dt>開始時刻</dt>
                    <dd>{fmt(detail.currentTask.startedAt)}</dd>
                    <dt>使用モデル</dt>
                    <dd>{detail.employee.modelProfile}(プロファイル)</dd>
                    <dt>入力資料</dt>
                    <dd>{detail.currentTask.inputJson ?? "指定なし"}</dd>
                    <dt>現在の段階</dt>
                    <dd>{detail.display.stage ?? "記録なし(進捗率は表示しません)"}</dd>
                  </dl>
                  {detail.currentTask.status === "running" || detail.currentTask.status === "queued" ? (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => void taskAction(detail.currentTask!.id, "cancel")}
                    >
                      このタスクを停止する
                    </button>
                  ) : null}
                </>
              ) : (
                <p style={{ fontSize: 13 }}>実行中のタスクはありません。</p>
              )}
              {actionError ? <p className="error-box">{actionError}</p> : null}
            </div>

            <div className="section">
              <h3>実行ログ(イベント)</h3>
              {detail.currentTask && detail.currentTask.events.length > 0 ? (
                detail.currentTask.events.map((ev) => (
                  <div key={ev.id} className="event-line">
                    {new Date(ev.ts).toLocaleTimeString("ja-JP")} [{ev.type}] {ev.payloadJson ?? ""}
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 13 }}>表示できるイベントはありません。</p>
              )}
            </div>

            <div className="section">
              <h3>成果物(最新10件)</h3>
              {detail.artifacts.length > 0 ? (
                <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
                  {detail.artifacts.map((a) => (
                    <li key={a.id}>
                      {a.kind} v{a.version}({fmt(a.createdAt)})
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 13 }}>成果物はまだありません。</p>
              )}
            </div>

            <div className="section">
              <h3>推定使用量</h3>
              <dl>
                <dt>推定出力文字数</dt>
                <dd>{detail.usage.estOutputChars.toLocaleString()} 字(推定値)</dd>
                <dt>実行時間合計</dt>
                <dd>{detail.usage.wallSeconds} 秒</dd>
                <dt>記録件数</dt>
                <dd>{detail.usage.records} 件</dd>
              </dl>
            </div>

            <div className="section">
              <h3>エラー・失敗</h3>
              {detail.recentTasks.filter((t) => t.status === "failed").length > 0 ? (
                detail.recentTasks
                  .filter((t) => t.status === "failed")
                  .slice(0, 3)
                  .map((t) => (
                    <div key={t.id}>
                      <p className="error-box">
                        {t.title}: {t.error ?? "理由未記録"}
                      </p>
                      <button type="button" className="btn-secondary" onClick={() => void taskAction(t.id, "resume")}>
                        再キューに戻す(再開)
                      </button>
                    </div>
                  ))
              ) : (
                <p style={{ fontSize: 13 }}>未回収のエラーはありません。</p>
              )}
            </div>

            <div className="section">
              <h3>次の予定</h3>
              {detail.nextPlanned.length > 0 ? (
                <ul style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
                  {detail.nextPlanned.map((t) => (
                    <li key={t.id}>
                      {t.title}({t.status})
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: 13 }}>予定されたタスクはありません。</p>
              )}
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
