"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { ApprovalQueueItem } from "@adapters/db/store";
import { IconStamp, IconCheck, IconAlert } from "@/components/icons";
import { AppShell, PageHeader } from "@/components/AppShell";

type Action = "approve" | "reject" | "revise";

interface CopyContent {
  headline?: string;
  body?: string;
  cta?: string;
  hashtags?: string[];
}

interface QaChecklistItem {
  item: string;
  ok: boolean;
  note?: string;
}

/** 承認キュー S-03(docs/10)。承認・却下・修正依頼(理由必須)を行う代表者の作業場 */
export default function ApprovalsPage(): JSX.Element {
  const [items, setItems] = useState<ApprovalQueueItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      const list = json as ApprovalQueueItem[];
      setItems(list);
      setSelectedId((prev) => (prev && list.some((i) => i.post.id === prev) ? prev : (list[0]?.post.id ?? null)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = items?.find((i) => i.post.id === selectedId) ?? null;

  async function act(action: Action): Promise<void> {
    if (!selected) return;
    if ((action === "reject" || action === "revise") && !comment.trim()) {
      setError("却下・修正依頼には理由の入力が必要です");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${selected.post.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ action, comment: comment.trim() || undefined }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "操作に失敗しました");
      setNotice(
        action === "approve"
          ? "承認しました。公開準備画面で書き出し(export)できます。"
          : action === "reject"
            ? "却下しました(理由は監査ログに記録)"
            : "修正依頼を登録しました(琴葉の修正タスクを自動生成)",
      );
      setComment("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const copy = (selected?.copy ?? null) as CopyContent | null;
  const checklist = (selected?.qa?.checklist ?? []) as QaChecklistItem[];

  return (
    <AppShell current="/approvals" title="承認キュー">
      <PageHeader title="承認キュー" subtitle="QA合格投稿のみが届きます。承認・却下・修正依頼はこの画面でのみ行えます。" />

      {notice ? (
        <p role="status" style={{ margin: 16, padding: 10, background: "#eef7ee", border: "1.5px solid var(--color-success)", borderRadius: 4 }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="error-box" style={{ margin: 16 }} role="alert">
          {error}
        </p>
      ) : null}

      {items && items.length === 0 ? (
        <div style={{ padding: 32, maxWidth: 640, margin: "0 auto" }}>
          <h2 style={{ fontSize: 17 }}>承認待ちの投稿はありません</h2>
          <p style={{ fontSize: 14 }}>QAに合格した投稿だけがここに届きます。/kickoff実行後に確認してください。</p>
        </div>
      ) : null}

      {selected ? (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, padding: 16, maxWidth: 1200, margin: "0 auto" }}>
          <nav aria-label="承認待ち一覧">
            {items?.map((i) => (
              <button
                key={i.post.id}
                type="button"
                className="btn-secondary"
                aria-pressed={i.post.id === selectedId}
                onClick={() => setSelectedId(i.post.id)}
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 8, borderColor: i.post.id === selectedId ? "var(--color-info)" : undefined }}
              >
                <strong style={{ fontSize: 13 }}>{i.post.title}</strong>
                <br />
                <small>柱{i.post.pillar} / {i.post.format} / copy v{i.copyVersion ?? "-"}</small>
              </button>
            ))}
          </nav>

          <section aria-label="投稿プレビュー" style={{ background: "#fff", border: "2px solid var(--color-wall)", borderRadius: 8, padding: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>{selected.post.title}</h2>

            {selected.integrityError ? (
              <div className="error-box" role="alert">
                <strong>要修復 — この投稿はいま承認できません</strong>
                <p style={{ margin: "6px 0 0" }}>{selected.integrityError}</p>
                <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                  修復後(再レンダリング+再QA)に自動で承認可能になります。他の投稿の承認は通常どおり行えます。
                </p>
              </div>
            ) : null}

            <h3 style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>カルーセル({selected.imageArtifactIds.length}枚)</h3>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
              {selected.imageArtifactIds.map((id, idx) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={id}
                  src={`/api/artifacts/${id}/file`}
                  alt={`カルーセル ${idx + 1}枚目のプレビュー`}
                  width={216}
                  height={270}
                  style={{ border: "1px solid var(--color-wall)", flexShrink: 0 }}
                />
              ))}
              {selected.imageArtifactIds.length === 0 ? <p style={{ fontSize: 13 }}>画像はまだ生成されていません。</p> : null}
            </div>

            <h3 style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>キャプション</h3>
            {copy ? (
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap", background: "var(--color-surface)", padding: 12, borderRadius: 6 }}>
                <strong>{copy.headline}</strong>
                {"\n\n"}
                {copy.body}
                {"\n\n"}
                {copy.cta}
                {"\n\n"}
                {(copy.hashtags ?? []).join(" ")}
              </div>
            ) : (
              <p style={{ fontSize: 13 }}>キャプションがありません。</p>
            )}

            <h3 style={{ fontSize: 13, color: "var(--color-ink-muted)", marginTop: 14 }}>QAレポート</h3>
            {selected.qa ? (
              <>
                <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                  {checklist.map((c, i) => (
                    <li key={i}>
                      {c.ok ? <IconCheck size={12} /> : <IconAlert size={12} />} {c.item}
                      {c.note ? ` — ${c.note}` : ""}
                    </li>
                  ))}
                </ul>
                {selected.qa.notes.length > 0 ? (
                  <div style={{ fontSize: 13, background: "#fff8e8", border: "1px solid var(--color-warning)", borderRadius: 6, padding: 8 }}>
                    <strong>代表者確認をお願いしたい軽微な指摘:</strong>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {selected.qa.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p style={{ fontSize: 13 }}>QAレポートがありません。</p>
            )}

            <h3 style={{ fontSize: 13, color: "var(--color-ink-muted)", marginTop: 14 }}>情報源(出典)</h3>
            {selected.sources.length > 0 ? (
              <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                {selected.sources.map((s) => (
                  <li key={s.id}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.publisher}「{s.title}」
                    </a>{" "}
                    公開: {s.publishedAt || "不明"} / 確認: {s.checkedAt}
                    {s.verificationStatus !== "confirmed" ? "(未確認)" : ""}
                    {" / 区分: "}
                    {s.factOrInference}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 13 }}>この投稿に紐付いた情報源はありません(ニュース引用なし)。</p>
            )}

            {selected.decisions.length > 0 ? (
              <>
                <h3 style={{ fontSize: 13, color: "var(--color-ink-muted)" }}>過去の判断履歴</h3>
                <ul style={{ fontSize: 12, paddingLeft: 18 }}>
                  {selected.decisions.map((d, i) => (
                    <li key={i}>
                      {new Date(d.decidedAt).toLocaleString("ja-JP")} — {d.decision}
                      {d.comment ? `(${d.comment})` : ""}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <div className="section" style={{ borderTop: "1px solid var(--color-surface-dark)", marginTop: 14, paddingTop: 12 }}>
              <label htmlFor="decision-comment" style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
                コメント(却下・修正依頼では必須。承認では任意)
              </label>
              <textarea
                id="decision-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                style={{ width: "100%", font: "inherit", padding: 8, border: "2px solid var(--color-wall)", borderRadius: 4 }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  disabled={busy || !!selected.integrityError}
                  title={selected.integrityError ? "要修復のため承認できません" : undefined}
                  onClick={() => void act("approve")}
                  style={{ background: "var(--color-success)", color: "#fff", border: "none", borderRadius: 4, padding: "8px 20px", fontWeight: 700, opacity: selected.integrityError ? 0.5 : 1 }}
                >
                  承認する
                </button>
                <button type="button" disabled={busy} className="btn-secondary" onClick={() => void act("revise")}>
                  修正依頼
                </button>
                <button type="button" disabled={busy} className="btn-danger" onClick={() => void act("reject")}>
                  却下
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--color-ink-muted)", marginTop: 8 }}>
                すべての判断は監査ログに記録されます。Instagramへの投稿は承認・書き出し後に代表者が手動で行います。
              </p>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
