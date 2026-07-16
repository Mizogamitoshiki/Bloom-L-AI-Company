"use client";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { HomeView } from "@adapters/db/views";
import { AppShell } from "@/components/AppShell";
import { OfficeView } from "@/components/OfficeView";
import { ListView } from "@/components/ListView";
import { EmployeeDrawer } from "@/components/EmployeeDrawer";
import { RightPanel, OfficeSrAlternative } from "@/components/RightPanel";
import { KpiCard, EmptyState, ErrorState } from "@/components/ui";
import { IconPen, IconStamp, IconUsers, IconQuestion } from "@/components/icons";

const POLL_MS = 2000;

export default function HomePage(): JSX.Element {
  const [home, setHome] = useState<HomeView | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [animOff, setAnimOff] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reducedMotion = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
    const saved = window.localStorage.getItem("bloom.animOff");
    setAnimOff(saved !== null ? saved === "true" : mq.matches);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/home", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "状態の取得に失敗しました");
      setHome(json as HomeView);
      setFetchError(null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [poll]);

  function toggleAnim(): void {
    const next = !animOff;
    setAnimOff(next);
    window.localStorage.setItem("bloom.animOff", String(next));
  }

  async function resume(): Promise<void> {
    const res = await fetch("/api/system", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
      body: JSON.stringify({ action: "resume_generation" }),
    });
    if (res.ok) await poll();
  }

  const state = home?.state ?? null;

  useEffect(() => {
    if (!selected && state?.employees.length) {
      setSelected(state.employees.find((employee) => employee.id === "emp_aoi")?.id ?? state.employees[0]?.id ?? null);
    }
  }, [selected, state]);
  const runLabel = state?.run
    ? state.run.status === "running"
      ? "AIマーケティング部 稼働中"
      : state.run.status === "done"
        ? "本日のrunは正常終了"
        : "前回runは異常終了(回収済み)"
    : "待機中";

  return (
    <div className={animOff ? "anim-off" : "anim-on"}>
      <AppShell
        current="/"
        title="Bloom-L AI Company"
        onResume={resume}
        topbar={{
          statusLabel: runLabel,
          paused: state?.generationPause ? { reason: state.generationPause.reason } : null,
          awaitingCount: state?.counts.awaitingApproval,
        }}
      >
        {state?.demoMode ? (
          <div className="demo-banner" role="status" style={{ margin: "-20px -20px 16px" }}>
            デモデータ表示中 — 実データではありません(`pnpm company init` で実運用データに切り替え)
          </div>
        ) : null}

        <h1 className="sr-only">AIマーケティング部 オフィス</h1>
        <div className="office-commandbar" aria-label="オフィス表示設定">
          <span><span className="dot" /> LIVE COMPANY FLOOR</span>
          <button type="button" className="office-commandbar__toggle" onClick={toggleAnim} aria-pressed={animOff}>
            {animOff ? "オフィス表示" : "一覧表示"}
          </button>
        </div>

        {fetchError && !home ? (
          <ErrorState
            title="状態を取得できません"
            message={`${fetchError}(表示は最新ではない可能性があります)`}
            action={
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void poll()}>
                再試行
              </button>
            }
          />
        ) : null}

        {fetchError && home ? (
          <div className="home-sync-warning" role="status">
            <span><strong>最新状態を再取得できませんでした。</strong> 現在は直前に取得した会社情報を表示しています。</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void poll()}>
              再接続する
            </button>
          </div>
        ) : null}

        {!home && !fetchError ? <EmptyState title="読み込み中…" /> : null}

        {home && state ? (
          state.run ? (
            <>
              <OfficeSrAlternative employees={state.employees} />
              <div className="home-layout">
                <div className="home-main">
                  {animOff ? (
                    <ListView state={state} onSelect={setSelected} />
                  ) : (
                    <OfficeView
                      state={state}
                      selectedId={selected}
                      onSelect={setSelected}
                      onOpenDetail={setDetailEmployee}
                    />
                  )}
                  <div className="kpi-row">
                    <KpiCard label="今日の投稿数" value={home.kpi.postsToday} icon={<IconPen size={22} />} tone="primary" />
                    <KpiCard label="承認待ち" value={home.kpi.awaitingApproval} icon={<IconStamp size={22} />} tone="warning" href="/approvals" />
                    <KpiCard label="稼働中のAI社員" value={home.kpi.activeEmployees} icon={<IconUsers size={22} />} tone="success" />
                    <KpiCard
                      label="今月の問い合わせ数"
                      value={home.kpi.monthlyInquiries}
                      icon={<IconQuestion size={22} />}
                      tone="muted"
                      note="Instagram DM連携は第2段階(データ源なし)"
                    />
                  </div>
                </div>
                <div className="home-side">
                  <RightPanel home={home} now={now} onSelect={setDetailEmployee} />
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              title="まだ稼働していません"
              message="Claude Code でこのリポジトリを開き、始業コマンド(/kickoff)を実行するとAI会社が稼働します。動作確認は pnpm company seed --demo でデモデータを投入できます。"
              icon={<IconUsers size={32} />}
            />
          )
        ) : null}
      </AppShell>

      {detailEmployee ? <EmployeeDrawer employeeId={detailEmployee} onClose={() => setDetailEmployee(null)} /> : null}
    </div>
  );
}
