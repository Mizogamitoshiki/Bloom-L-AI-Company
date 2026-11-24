"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { MeetingView } from "@adapters/db/views";
import { AppShell, PageHeader } from "@/components/AppShell";

interface IdeaItem {
  id: string;
  text: string;
  status: string;
  resolution: string | null;
  resolutionRefJson: string | null;
  createdAt: string;
}

const IDEA_STATUS_LABEL: Record<string, string> = {
  new: "未着手",
  planned: "計画済み",
  in_progress: "実行中",
  done: "実現済み",
  declined: "見送り",
};
const IDEA_STATUS_COLOR: Record<string, string> = {
  new: "var(--color-warning)",
  planned: "var(--color-primary)",
  in_progress: "var(--color-primary)",
  done: "var(--color-success)",
  declined: "var(--color-text-muted)",
};

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
  const [ideas, setIdeas] = useState<IdeaItem[] | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, ideasRes] = await Promise.all([
        fetch("/api/meetings", { cache: "no-store" }),
        fetch("/api/ideas", { cache: "no-store" }),
      ]);
      const json: unknown = await res.json();
      const ideasJson: unknown = await ideasRes.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      if (!ideasRes.ok) throw new Error((ideasJson as { error?: string }).error ?? "アイデアの取得に失敗しました");
      setItems(json as MeetingView[]);
      setIdeas((ideasJson as { ideas: IdeaItem[] }).ideas);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addIdea(): Promise<void> {
    const text = ideaText.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ text }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "追加に失敗しました");
      setIdeaText("");
      setNotice("アイデアを記録しました。次回の /kickoff または /weekly-review で、AI社員が実行方法を検討して着手します。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function declineIdea(idea: IdeaItem): Promise<void> {
    const reason = window.prompt("このアイデアを見送りにします。理由を入力してください(記録されます)");
    if (reason === null) return;
    if (!reason.trim()) { setError("見送りには理由が必要です"); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ideas/${idea.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ status: "declined", resolution: reason.trim() }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "更新に失敗しました");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell current="/meetings" title="会議・議事録">
      <PageHeader
        title="会議・議事録"
        subtitle="週次/月次会議の議事録と、代表者のひらめきメモ。メモは次回の /kickoff・/weekly-review でAI社員が実行に変換します。"
      />
      {notice ? <p role="status" style={{ marginBottom: 12, padding: 10, background: "var(--color-success-soft)", border: "1px solid var(--color-success)", borderRadius: 8, fontSize: 13 }}>{notice}</p> : null}
      {error ? <p className="error-box" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}

      {/* V7: ひらめきメモ(代表者アイデアボックス)。思いつきを書くだけで、実行はAI社員が既存の安全経路で行う */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card__header"><h2 className="card__title">ひらめきメモ(アイデアボックス)</h2></div>
        <div className="card__body" style={{ display: "grid", gap: 12 }}>
          <p style={{ fontSize: 12.5, color: "var(--color-text-muted)", margin: 0 }}>
            その場で思いついたことを書いてください(投稿ネタ・運用の改善・試したいこと等)。
            次回の /kickoff や /weekly-review で葵たちが実行方法を検討し、投稿企画・タスク・会議議題に変換します。実現状況はここに表示されます。
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
              placeholder="例: お客様の声を投稿に入れたい / 祭りの時期に合わせた投稿をしたい"
              rows={2}
              maxLength={500}
              style={{ flexGrow: 1, fontSize: 13.5, padding: 10, borderRadius: 8, border: "1px solid var(--color-border)", resize: "vertical", fontFamily: "inherit" }}
            />
            <button type="button" className="btn btn--primary" disabled={busy || !ideaText.trim()} onClick={() => void addIdea()}>
              記録する
            </button>
          </div>
          {ideas && ideas.length > 0 ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {ideas.map((idea) => (
                <li key={idea.id} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: IDEA_STATUS_COLOR[idea.status] ?? "var(--color-text)" }}>
                      {IDEA_STATUS_LABEL[idea.status] ?? idea.status}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{new Date(idea.createdAt).toLocaleString("ja-JP")}</span>
                    {idea.status !== "done" && idea.status !== "declined" ? (
                      <button type="button" className="btn btn--secondary btn--sm" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void declineIdea(idea)}>
                        見送り
                      </button>
                    ) : null}
                  </div>
                  <span style={{ fontSize: 13.5 }}>{idea.text}</span>
                  {idea.resolution ? (
                    <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>→ {idea.resolution}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : ideas ? (
            <p style={{ fontSize: 12.5, color: "var(--color-text-muted)", margin: 0 }}>まだメモはありません。</p>
          ) : null}
        </div>
      </section>
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
