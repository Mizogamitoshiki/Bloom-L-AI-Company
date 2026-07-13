"use client";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { CompanyStateView } from "@adapters/db/store";
import { OfficeView } from "@/components/OfficeView";
import { ListView } from "@/components/ListView";
import { EmployeeDrawer } from "@/components/EmployeeDrawer";
import { IconAlert, IconStamp, IconClock } from "@/components/icons";

const POLL_MS = 2000;

export default function HomePage(): JSX.Element {
  const [state, setState] = useState<CompanyStateView | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [animOff, setAnimOff] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    // 保存された表示設定+OSのreduced-motionを尊重(確定§13)
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
    const saved = window.localStorage.getItem("bloom.animOff");
    setAnimOff(saved !== null ? saved === "true" : mq.matches);
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "状態の取得に失敗しました");
      setState(json as CompanyStateView);
      setFetchError(null);
    } catch (e) {
      // 取得失敗を隠さない(古い表示を「現在の状態」と誤認させない)
      setFetchError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  function toggleAnim(): void {
    const next = !animOff;
    setAnimOff(next);
    window.localStorage.setItem("bloom.animOff", String(next));
  }

  return (
    <div className={animOff ? "anim-off" : "anim-on"}>
      {state?.demoMode ? (
        <div className="demo-banner" role="status">
          デモデータ表示中 — 実データではありません(`pnpm company init` で実運用データに切り替え)
        </div>
      ) : null}
      <header className="header">
        <h1>Bloom-L AI Company — AIマーケティング部</h1>
        {state ? (
          <>
            <span className="stat">
              <IconClock size={13} />
              {state.run
                ? state.run.status === "running"
                  ? `本日run実行中(${new Date(state.run.startedAt).toLocaleTimeString("ja-JP")}開始)`
                  : `最終run: ${state.run.status === "done" ? "正常終了" : "異常終了(回収済み)"}`
                : "まだ稼働していません"}
            </span>
            <span className="stat" data-alert={state.counts.awaitingApproval > 0}>
              <IconStamp size={13} />
              承認待ち {state.counts.awaitingApproval}件
            </span>
            <span className="stat" data-alert={state.counts.errors > 0}>
              <IconAlert size={13} />
              エラー/状態不明 {state.counts.errors}件
            </span>
          </>
        ) : null}
        <button type="button" className="toggle-btn" onClick={toggleAnim} aria-pressed={animOff}>
          {animOff ? "オフィス表示に切り替え" : "アニメーションなし一覧に切り替え"}
        </button>
      </header>

      {fetchError ? (
        <p className="error-box" style={{ margin: 16 }} role="alert">
          状態を取得できません: {fetchError}(表示は最新ではない可能性があります)
        </p>
      ) : null}

      {!state && !fetchError ? <p style={{ padding: 16 }}>読み込み中…</p> : null}

      {state ? (
        state.run ? (
          animOff ? (
            <ListView state={state} onSelect={setSelected} />
          ) : (
            <OfficeView state={state} onSelect={setSelected} />
          )
        ) : (
          <div style={{ padding: 32, maxWidth: 640, margin: "0 auto" }} id="main">
            <h2 style={{ fontSize: 17 }}>まだ稼働していません</h2>
            <p style={{ fontSize: 14 }}>
              Claude Code でこのリポジトリを開き、始業コマンド(/kickoff)を実行するとAI会社が稼働します。
              動作を先に確認したい場合は <code>pnpm company seed --demo</code> でデモデータを投入できます。
            </p>
          </div>
        )
      ) : null}

      {selected ? <EmployeeDrawer employeeId={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
