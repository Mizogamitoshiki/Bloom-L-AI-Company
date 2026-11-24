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
  storageProvider: string;
  storageConfigured: boolean;
}
interface DryRunReport {
  plan?: { imageCount?: number; allHttps?: boolean; mediaUrls?: string[] };
  caption?: { length?: number; preview?: string };
  template?: { templateId?: string; version?: number; approved?: boolean } | null;
  qa?: { contentQaPass?: boolean; visualQaResult?: string | null; designQaResult?: string | null };
  graphApiVersion?: string;
  note?: string;
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
  const [dryRunResult, setDryRunResult] = useState<{ postId: string; report: DryRunReport } | null>(null);

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

  /** 公開結果不明(needs_reconciliation)の解消。代表者がInstagramアプリで確認した結果を記録する */
  async function reconcile(postId: string, outcome: "not_published" | "published"): Promise<void> {
    let instagramMediaId: string | undefined;
    if (outcome === "not_published") {
      if (!window.confirm("Instagramアプリを確認し、この投稿が公開されて【いない】ことを確認しましたか？\n記録すると再実行できるようになります。")) return;
    } else {
      const typed = window.prompt("Instagramに公開されていた場合、そのメディアID(数字)を入力してください。\n(Meta Business Suite等で確認できます)");
      if (typed === null) return;
      if (!/^\d+$/.test(typed.trim())) {
        setError("メディアIDは数字で入力してください");
        return;
      }
      instagramMediaId = typed.trim();
    }
    setBusy(postId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/instagram-reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify(outcome === "published" ? { outcome, instagramMediaId } : { outcome }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "操作に失敗しました");
      setNotice(outcome === "not_published" ? "未投稿を確認として記録しました。もう一度公開を実行できます。" : "投稿済みとして記録しました。");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function instagramAct(postId: string, postTitle: string): Promise<void> {
    if (!instagram || instagram.mode === "disabled") return;
    const isLive = instagram.mode === "live";
    if (isLive && !window.confirm("この投稿をBloom-L公式Instagramへ今すぐ公開します。公開後は取り消せません。画像・文章・アカウントを最終確認しましたか？")) return;
    let confirmedTitle: string | undefined;
    if (isLive) {
      const typed = window.prompt(`誤投稿防止のため、次の投稿タイトルを正確に入力してください。\n\n${postTitle}`);
      if (typed === null) return;
      if (typed !== postTitle) {
        setError("投稿タイトルが一致しないため、実投稿を中止しました");
        return;
      }
      confirmedTitle = typed;
    }
    setBusy(postId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/instagram-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({
          confirmation: isLive ? "PUBLISH_TO_INSTAGRAM" : undefined,
          confirmedPostId: isLive ? postId : undefined,
          confirmedTitle,
        }),
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

  /** V5.2: 公開画像の準備(Vercel Blobへアップロード)。owner専用・Metaへは送信しない */
  async function prepareMedia(postId: string): Promise<void> {
    setBusy(postId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/media-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "公開画像の準備に失敗しました");
      const r = json as { imageCount?: number; uploadedCount?: number; reusedCount?: number };
      setNotice(`公開画像を準備しました(${r.imageCount ?? 0}枚: 新規${r.uploadedCount ?? 0}・再利用${r.reusedCount ?? 0})。Instagramにはまだ投稿されていません。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** V5.2: dry-run実行。Metaへ一切送信せず投稿予定内容だけを確認する */
  async function runDryRun(postId: string): Promise<void> {
    setBusy(postId);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/instagram-dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "dry-runに失敗しました");
      setDryRunResult({ postId, report: json as DryRunReport });
      setNotice("dry-runが完了しました。Instagramにはまだ投稿されていません(Meta APIへは送信していません)。");
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
            {instagram.mode !== "live" ? (
              <p role="note" style={{ margin: 0, padding: "8px 10px", background: "var(--color-warning-soft)", border: "1px solid var(--color-warning)", borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                実投稿は無効です(META_PUBLISH_MODE={instagram.mode})。公開画像の準備・dry-runを実行しても、Instagramにはまだ投稿されていません。
              </p>
            ) : null}
            <p style={{ margin: 0, fontSize: 13 }}>
              API {instagram.apiVersion}。既定は無効で、実投稿は環境設定・公開画像URL・代表者の確認がすべて揃った場合だけ実行されます。手動投稿は常に利用できます。
            </p>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, fontSize: 12.5, margin: 0 }}>
              <div style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
                <dt style={{ color: "var(--color-text-muted)" }}>モード</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>{instagram.mode}</dd>
              </div>
              <div style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
                <dt style={{ color: "var(--color-text-muted)" }}>InstagramユーザーID</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>{instagram.accountConfigured ? "設定済み" : "未設定"}</dd>
              </div>
              <div style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
                <dt style={{ color: "var(--color-text-muted)" }}>アクセストークン</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>{instagram.tokenConfigured ? "設定済み" : "未設定"}</dd>
              </div>
              <div style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
                <dt style={{ color: "var(--color-text-muted)" }}>公開ストレージ({instagram.storageProvider})</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>{instagram.storageConfigured ? "設定済み" : "未設定"}</dd>
              </div>
            </dl>
            {!instagram.storageConfigured ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-text-muted)" }}>
                公開ストレージ未設定: Vercelダッシュボード → Storage → Blob でトークンを発行し、.env に BLOB_READ_WRITE_TOKEN を設定してください(値はここに表示されません)。
              </p>
            ) : null}
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
                  <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-text-muted)" }}>
                    公開画像URL: <strong>{it.mediaUploadCount > 0 ? `準備済み(${it.mediaUploadCount}枚)` : "未準備"}</strong>
                    {" ・ "}dry-run: <strong>{it.lastDryRunAt ? `実行済み(${new Date(it.lastDryRunAt).toLocaleString("ja-JP")})` : "未実行"}</strong>
                    {" — Instagramにはまだ投稿されていません"}
                  </p>
                  {it.instagramJob && ["publishing", "needs_reconciliation"].includes(it.instagramJob.status) ? (
                    <div className="error-box" role="alert" style={{ display: "grid", gap: 8 }}>
                      <span>
                        <strong>実投稿結果の確認が必要です。</strong>{" "}
                        Instagramアプリで同じ投稿が公開されていないか確認してください。二重投稿防止のため、この投稿は自動再送されません。
                        <br />ジョブID: <code>{it.instagramJob.id}</code>
                        {it.instagramJob.errorMessage ? <><br />エラー: {it.instagramJob.errorMessage}</> : null}
                      </span>
                      {it.instagramJob.status === "needs_reconciliation" ? (
                        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" className="btn btn--secondary btn--sm" disabled={busy === it.id} onClick={() => void reconcile(it.id, "not_published")}>
                            投稿されていなかった(再実行を許可)
                          </button>
                          <button type="button" className="btn btn--secondary btn--sm" disabled={busy === it.id} onClick={() => void reconcile(it.id, "published")}>
                            投稿されていた(メディアIDを記録)
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy === it.id || !instagram?.storageConfigured}
                      title={!instagram?.storageConfigured ? "BLOB_READ_WRITE_TOKEN が未設定です" : undefined}
                      onClick={() => void prepareMedia(it.id)}
                    >
                      公開画像を準備(Vercel Blob)
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy === it.id}
                      onClick={() => void runDryRun(it.id)}
                    >
                      dry-runを実行(Metaへ送信しない)
                    </button>
                    {instagram && instagram.mode !== "disabled" ? (
                      <button
                        type="button"
                        className={instagram.mode === "live" ? "btn btn--success" : "btn btn--secondary"}
                        disabled={
                          busy === it.id
                          || (instagram.mode === "live" && !instagram.liveReady)
                          || !!(it.instagramJob && ["publishing", "needs_reconciliation"].includes(it.instagramJob.status))
                        }
                        onClick={() => void instagramAct(it.id, it.title)}
                      >
                        {busy === it.id ? "処理中…" : instagram.mode === "live" ? "Instagramへ公式APIで公開" : "公式APIドライランを実行"}
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--secondary" disabled={busy === it.id} onClick={() => void act(it.id, "publish")}>
                      手動投稿済みとして記録
                    </button>
                  </div>

                  {dryRunResult && dryRunResult.postId === it.id ? (
                    <div role="region" aria-label="dry-run結果" style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 12, fontSize: 12.5, display: "grid", gap: 6 }}>
                      <strong>dry-run結果(Instagramにはまだ投稿されていません)</strong>
                      <span>画像: {dryRunResult.report.plan?.imageCount ?? 0}枚 / 全URL HTTPS: {dryRunResult.report.plan?.allHttps ? "はい" : "いいえ"}</span>
                      <span>キャプション: {dryRunResult.report.caption?.length ?? 0}文字 — {dryRunResult.report.caption?.preview ?? ""}…</span>
                      <span>
                        テンプレート: {dryRunResult.report.template ? `${dryRunResult.report.template.templateId} v${dryRunResult.report.template.version}(${dryRunResult.report.template.approved ? "承認済み" : "未承認"})` : "-"}
                        {" / "}Graph API: {dryRunResult.report.graphApiVersion}
                      </span>
                      <span>
                        内容QA: {dryRunResult.report.qa?.contentQaPass ? "合格" : "未合格"} / 視覚QA: {dryRunResult.report.qa?.visualQaResult ?? "-"} / design QA: {dryRunResult.report.qa?.designQaResult ?? "-"}
                      </span>
                      <span style={{ color: "var(--color-text-muted)" }}>{dryRunResult.report.note}</span>
                    </div>
                  ) : null}
                </>
              ) : null}

              {it.status === "published" || it.status === "measured" ? (
                <div>
                  <p style={{ fontSize: 13, margin: "0 0 6px" }}>
                    投稿済み{it.publishedAt ? `(${new Date(it.publishedAt).toLocaleString("ja-JP")})` : ""}。3日後・7日後にInstagramインサイトから実績値を入力してください。
                  </p>
                  {it.instagramJob?.status === "published" && it.instagramJob.instagramMediaId ? (
                    <p style={{ fontSize: 12.5, margin: "0 0 8px", color: "var(--color-text-muted)" }}>
                      Instagram公式API公開記録: メディアID <code>{it.instagramJob.instagramMediaId}</code>
                    </p>
                  ) : null}
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
