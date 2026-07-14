"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { PipelineView } from "@adapters/db/views";
import { AppShell, PageHeader } from "@/components/AppShell";

const STATUS_ORDER = [
  "idea",
  "drafting",
  "qa_review",
  "awaiting_approval",
  "revision_requested",
  "approved",
  "rejected",
  "exported",
  "published",
] as const;

const STATUS_LABEL: Record<string, string> = {
  idea: "企画",
  drafting: "制作中",
  qa_review: "品質確認",
  awaiting_approval: "承認待ち",
  revision_requested: "修正依頼",
  approved: "承認済み",
  rejected: "却下",
  exported: "書き出し済み",
  published: "投稿済み",
  measured: "計測済み",
};

const PILLAR_LABEL: Record<string, string> = {
  "1": "①ニュース", "2": "②HPの役割", "3": "③HPで変わる", "4": "④ITトピック", "5": "⑤実績", "6": "⑥泉州課題解決",
};

/** S-04 投稿パイプライン(V3-E)。DBの事実のみ表示。進捗率は表示しない */
export default function PipelinePage(): JSX.Element {
  const [view, setView] = useState<PipelineView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setView(json as PipelineView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell current="/pipeline" title="投稿パイプライン">
      <PageHeader title="投稿パイプライン" subtitle="全投稿の状態一覧(DBの事実のみ・進捗率は表示しません)。" />
      {error ? <p className="error-box" style={{ margin: 16 }} role="alert">{error}</p> : null}
      {view?.generationPause ? (
        <p className="error-box" style={{ margin: 16 }} role="alert">
          新規生成は停止中です: {view.generationPause.reason}(オフィス画面のバナーから再開できます)
        </p>
      ) : null}
      {view ? (
        <div className="list-view">
          <p style={{ fontSize: 13 }}>
            {STATUS_ORDER.map((s) => `${STATUS_LABEL[s]} ${view.counts[s] ?? 0}`).join(" / ")}
            {" / "}権利確認待ち {view.blockedRightsCount}
          </p>
          <table>
            <caption style={{ textAlign: "left", fontWeight: 700, paddingBottom: 8 }}>全投稿({view.items.length}件)</caption>
            <thead>
              <tr>
                <th scope="col">投稿</th>
                <th scope="col">状態</th>
                <th scope="col">権利</th>
                <th scope="col">柱</th>
                <th scope="col">テンプレート</th>
                <th scope="col">予定日</th>
                <th scope="col">最新タスク(担当)</th>
                <th scope="col">最新成果物</th>
                <th scope="col">QA</th>
                <th scope="col">エラー</th>
              </tr>
            </thead>
            <tbody>
              {view.items.map((i) => (
                <tr key={i.id}>
                  <th scope="row">
                    {i.status === "awaiting_approval" ? <a href="/approvals">{i.title}</a> : i.title}
                  </th>
                  <td>{STATUS_LABEL[i.status] ?? i.status}</td>
                  <td>{i.rightsState === "blocked_rights" ? "⚠ 権利確認待ち" : i.rightsState}</td>
                  <td>{PILLAR_LABEL[i.pillar] ?? i.pillar}</td>
                  <td>{i.templateId}</td>
                  <td>{i.plannedDate ?? "—"}</td>
                  <td>{i.latestTask ? `${i.latestTask.title}(${i.latestTask.assigneeName}・${i.latestTask.status})` : "—"}</td>
                  <td>{i.latestArtifactKind ?? "—"}</td>
                  <td>{i.qaResult ?? "—"}</td>
                  <td>{i.hasError ? "あり" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ padding: 16 }}>読み込み中…</p>
      )}
    </AppShell>
  );
}
