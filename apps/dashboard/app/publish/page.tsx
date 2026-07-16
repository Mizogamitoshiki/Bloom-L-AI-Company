"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { PublishReadyItem } from "@adapters/db/store";
import { AppShell, PageHeader } from "@/components/AppShell";

const STATUS_LABEL: Record<string, string> = {
  approved: "承認済み(書き出し可)",
  exported: "書き出し済み(投稿待ち)",
  published: "投稿済み",
  measured: "計測済み",
};

const METRIC_FIELDS: [keyof MetricForm, string][] = [
  ["reach", "リーチ"],
  ["profileViews", "プロフィール閲覧"],
  ["saves", "保存"],
  ["shares", "シェア"],
  ["comments", "コメント"],
  ["dmStarts", "DM開始"],
  ["followerCount", "フォロワー数"],
];
interface MetricForm {
  reach: string; profileViews: string; saves: string; shares: string; comments: string; dmStarts: string; followerCount: string; note: string;
}
interface InstagramReadiness {
  mode: "disabled" | "dry_run" | "live";
  apiVersion: string;
  accountConfigured: boolean;
  tokenConfigured: boolean;
  mediaBaseConfigured: boolean;
  liveReady: boolean;
  externalSendEnabled: boolean;
  missing: string[];
}
const EMPTY_METRIC: MetricForm = { reach: "", profileViews: "", saves: "", shares: "", comments: "", dmStarts: "", followerCount: "", note: "" };

/** S(公開準備): approved→書き出し / exported→投稿済み記録 / published→実績値入力。承認操作はここに置かない */
export default function PublishPage(): JSX.Element {
  const [items, setItems] = useState<PublishReadyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [metricFor, setMetricFor] = useState<{ postId: string; window: 3 | 7 } | null>(null);
  const [metricForm, setMetricForm] = useState<MetricForm>(EMPTY_METRIC);
  const [instagram, setInstagram] = useState<InstagramReadiness | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, instagramRes] = await Promise.all([
        fetch("/api/publish-ready", { cache: "no-store" }),
        fetch("/api/instagram/readiness", { cache: "no-store" }),
      ]);
      const json: unknown = await res.json();
      const instagramJson: unknown = await instagramRes.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      if (!instagramRes.ok) throw new Error("Instagram接続状態の取得に失敗しました");
      setItems(json as PublishReadyItem[]);
      setInstagram(instagramJson as InstagramReadiness);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(postId: string, kind: "export" | "publish"): Promise<void> {
    setBusy(postId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" } });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "操作に失敗しました");
      setNotice(
        kind === "export"
          ? `書き出しました: ${(json as { exportPath?: string }).exportPath ?? ""}。data/workspace/ 配下のフォルダから手動投稿してください。`
          : "投稿済みとして記録し、3日後・7日後の実績値入力タスクを作成しました。",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function instagramAct(postId: string): Promise<void> {
    if (!instagram || instagram.mode === "disabled") return;
    const isLive = instagram.mode === "live";
    if (isLive && !window.confirm("この投稿をBloom-L公式Instagramへ今すぐ公開します。公開後は取り消せません。画像・文章・アカウントを最終確認しましたか？")) return;
    setBusy(postId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/instagram-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ confirmation: isLive ? "PUBLISH_TO_INSTAGRAM" : undefined }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Instagram公開処理に失敗しました");
      const result = json as { mode?: string; plan?: { imageCount?: number }; instagramMediaId?: string | null };
      setNotice(
        result.mode === "dry_run"
          ? `ドライラン成功: ${result.plan?.imageCount ?? 0}枚の公式API投稿計画を検証しました。Instagramへは送信していません。`
          : `Instagramへの公開が完了しました。メディアID: ${result.instagramMediaId ?? "記録済み"}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveMetric(postId: string, window: 3 | 7): Promise<void> {
    setBusy(postId);
    setError(null);
    try {
      const body: Record<string, number | string> = { windowDays: window };
      for (const [k] of METRIC_FIELDS) {
        const v = metricForm[k].trim();
        if (v !== "") body[k] = Number(v); // 空欄はNULLのまま送らない(0/推定で埋めない)
      }
      if (metricForm.note.trim()) body.note = metricForm.note.trim();
      const res = await fetch(`/api/posts/${postId}/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "保存に失敗しました");
      setNotice(`${window}日後の実績値を保存しました(未入力欄は未取得のまま)。`);
      setMetricFor(null);
      setMetricForm(EMPTY_METRIC);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell current="/publish" title="公開準備">
      <PageHeader
        title="公開準備"
        subtitle="承認済み投稿の書き出し → 代表者確認 → 手動投稿またはInstagram公式API投稿 → 実績値入力。"
      />
      {notice ? (
        <p role="status" style={{ marginBottom: 12, padding: 10, background: "var(--color-success-soft)", border: "1px solid var(--color-success)", borderRadius: 8, fontSize: 13 }}>
          {notice}
        </p>
      ) : null}
      {error ? <p className="error-box" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}

      {instagram ? (
        <section className="card" aria-labelledby="instagram-connection-title" style={{ marginBottom: 12 }}>
          <div className="card__header">
            <h2 id="instagram-connection-title" className="card__title">Instagram公式API</h2>
            <span className="status-badge" data-state={instagram.liveReady ? "done_today" : instagram.mode === "disabled" ? "idle" : "awaiting_approval"}>
              {instagram.mode === "live" ? (instagram.liveReady ? "実投稿可能" : "設定不足") : instagram.mode === "dry_run" ? "ドライラン" : "無効"}
            </span>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              API {instagram.apiVersion}。既定は無効で、実投稿は環境設定・公開画像URL・代表者の確認がすべて揃った場合だけ実行されます。手動投稿は常に利用できます。
            </p>
            {instagram.missing.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {instagram.missing.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}

      {items && items.length === 0 ? (
        <div className="card"><div className="card__body">
          <p style={{ fontSize: 14, margin: 0 }}>承認済み以降の投稿はまだありません。承認画面で投稿を承認すると、ここに書き出し導線が表示されます。</p>
        </div></div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        {items?.map((it) => (
          <section key={it.id} className="card">
            <div className="card__header">
              <h2 className="card__title">{it.title}</h2>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-muted)" }}>{STATUS_LABEL[it.status] ?? it.status}</span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 10 }}>
              {it.integrityError ? (
                <div className="error-box">
                  <strong>要修復:</strong> {it.integrityError}
                </div>
              ) : null}

              {it.imageArtifactIds.length > 0 ? (
                <div className="post-preview__thumbs">
                  {it.imageArtifactIds.slice(0, 6).map((id, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={id} src={`/api/artifacts/${id}/file`} alt={`カルーセル ${i + 1}枚目`} />
                  ))}
                </div>
              ) : null}

              {it.status === "approved" ? (
                <button type="button" className="btn btn--primary" disabled={busy === it.id || !!it.integrityError} onClick={() => void act(it.id, "export")}>
                  書き出し(export_bundle を生成)
                </button>
              ) : null}

              {it.status === "exported" ? (
                <>
                  <p style={{ fontSize: 13, margin: 0 }}>
                    書き出し先: <code>{it.exportPath}</code> — このフォルダの画像と caption.txt / checklist.md を使い、代表者がInstagramへ手動投稿してください。
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {instagram && instagram.mode !== "disabled" ? (
                      <button
                        type="button"
                        className={instagram.mode === "live" ? "btn btn--success" : "btn btn--secondary"}
                        disabled={busy === it.id || (instagram.mode === "live" && !instagram.liveReady)}
                        onClick={() => void instagramAct(it.id)}
                      >
                        {busy === it.id ? "処理中…" : instagram.mode === "live" ? "Instagramへ公式APIで公開" : "公式APIドライランを実行"}
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--secondary" disabled={busy === it.id} onClick={() => void act(it.id, "publish")}>
                      手動投稿済みとして記録
                    </button>
                  </div>
                </>
              ) : null}

              {it.status === "published" || it.status === "measured" ? (
                <div>
                  <p style={{ fontSize: 13, margin: "0 0 6px" }}>
                    投稿済み{it.publishedAt ? `(${new Date(it.publishedAt).toLocaleString("ja-JP")})` : ""}。3日後・7日後にInstagramインサイトから実績値を入力してください。
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[3, 7].map((w) => {
                      const m = it.metrics.find((x) => x.windowDays === w);
                      return (
                        <button
                          key={w}
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            setMetricFor({ postId: it.id, window: w as 3 | 7 });
                            setMetricForm(EMPTY_METRIC);
                          }}
                        >
                          {w}日後の実績値を{m?.hasData ? "更新" : "入力"}
                        </button>
                      );
                    })}
                  </div>

                  {metricFor && metricFor.postId === it.id ? (
                    <fieldset style={{ marginTop: 10, border: "1px solid var(--color-border)", borderRadius: 8, padding: 12 }}>
                      <legend style={{ fontSize: 13, fontWeight: 700 }}>{metricFor.window}日後の実績値(未入力欄は保存されず「未取得」のまま)</legend>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                        {METRIC_FIELDS.map(([k, label]) => (
                          <label key={k} style={{ fontSize: 12 }}>
                            {label}
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={metricForm[k]}
                              onChange={(e) => setMetricForm({ ...metricForm, [k]: e.target.value })}
                              style={{ display: "block", width: "100%", font: "inherit", padding: 6, border: "1px solid var(--color-border-strong)", borderRadius: 6 }}
                            />
                          </label>
                        ))}
                      </div>
                      <label style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                        メモ
                        <input
                          value={metricForm.note}
                          onChange={(e) => setMetricForm({ ...metricForm, note: e.target.value })}
                          style={{ display: "block", width: "100%", font: "inherit", padding: 6, border: "1px solid var(--color-border-strong)", borderRadius: 6 }}
                        />
                      </label>
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button type="button" className="btn btn--primary btn--sm" disabled={busy === it.id} onClick={() => void saveMetric(it.id, metricFor.window)}>
                          保存する
                        </button>
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setMetricFor(null)}>
                          閉じる
                        </button>
                      </div>
                    </fieldset>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
