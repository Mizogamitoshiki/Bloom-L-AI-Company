"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";

interface DesignQa { result: string; failures: string[] }
interface PreviewMeta {
  templateId: string; family: string; version: number; variant: string; fingerprint: string; pageCount: number;
  files: string[]; contactSheet: string; contentQa: { result: string; issues: string[] }; designQa: DesignQa;
  rights: string; fixtureKind: string;
}
interface VariantQa { variant: string; contentQaResult: string | null; mechanicalQaResult: string | null; visualQaResult: string | null; previewComplete: number; visualQaJson: string | null }
interface VariantEntry { variant: string; preview: PreviewMeta | null; qa: VariantQa | null }
interface Item {
  templateId: string; family: string; version: number | null; status: string; fingerprint: string; note: string | null;
  variants: VariantEntry[]; approvability: { ok: boolean; failures: { variant: string; reason: string }[] };
  publishVersion: number | null;
  versionHistory: { version: number; status: string }[];
}

const STATUS_LABEL: Record<string, string> = { draft: "確認待ち(draft)", approved: "承認済み", rejected: "却下", revision_requested: "修正依頼" };
const qaBadge = (v: string | null): string => (v === "pass" ? "✓合格" : v === "fail" ? "×不合格" : "—未実施");

export default function TemplatesPage(): JSX.Element {
  const [items, setItems] = useState<Item[] | null>(null);
  const [overview, setOverview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, string>>({}); // templateId -> variant
  const [viewed, setViewed] = useState<Record<string, Set<string>>>({}); // templateId -> viewed variants
  const [zoom, setZoom] = useState<{ tpl: string; version: number; variant: string; page: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/templates", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      const d = json as { items: Item[]; overviewExists: boolean };
      setItems(d.items);
      setOverview(d.overviewExists);
      setSel((prev) => {
        const next = { ...prev };
        for (const it of d.items) if (!next[it.templateId] && it.variants[0]) next[it.templateId] = it.variants[0].variant;
        return next;
      });
      setViewed((prev) => {
        const next = { ...prev };
        for (const it of d.items) { if (!next[it.templateId]) next[it.templateId] = new Set(); if (it.variants[0]) next[it.templateId]!.add(it.variants[0].variant); }
        return next;
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function selectVariant(tpl: string, variant: string): void {
    setSel((p) => ({ ...p, [tpl]: variant }));
    setViewed((p) => { const s = new Set(p[tpl] ?? []); s.add(variant); return { ...p, [tpl]: s }; });
  }

  async function decide(it: Item, decision: string): Promise<void> {
    let note: string | undefined;
    if (decision === "rejected" || decision === "revision_requested") {
      const reason = window.prompt(`${decision === "rejected" ? "却下" : "修正依頼"}の理由を入力してください(必須・監査ログに記録)`);
      if (!reason || !reason.trim()) { setError("却下・修正依頼には理由が必要です"); return; }
      note = reason.trim();
    } else {
      const allViewed = it.variants.every((v) => viewed[it.templateId]?.has(v.variant));
      const qaStates = it.variants.map((v) => `${v.variant}: content ${qaBadge(v.qa?.contentQaResult ?? null)} / design ${qaBadge(v.qa?.mechanicalQaResult ?? null)} / visual ${qaBadge(v.qa?.visualQaResult ?? null)}`).join("\n");
      if (!allViewed) { setError("承認前に全variantを確認してください(未確認のvariantがあります)"); return; }
      const ok = window.confirm(`次のテンプレート版を承認します。\n\nID: ${it.templateId}\nversion: ${it.version}\nfingerprint: ${it.fingerprint.slice(0, 16)}…\nvariant数: ${it.variants.length}\n\nQA状態:\n${qaStates}\n\n承認してよろしいですか?`);
      if (!ok) return;
    }
    setBusy(it.templateId);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${it.templateId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ decision, version: it.version, note }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "操作に失敗しました");
      setNotice(`${it.templateId} v${it.version} を ${STATUS_LABEL[decision] ?? decision} にしました(監査ログに記録)。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const imgUrl = (tpl: string, version: number, variant: string, name: string): string => `/api/template-previews/${tpl}/v${version}/${variant}/${name}`;

  return (
    <AppShell current="/templates" title="投稿テンプレート">
      <PageHeader title="投稿テンプレート(ゴールデンプレビュー v2)" subtitle="4系統×2variantの見本を確認してください。全variantを確認し、content/design/visual QAが揃ったテンプレート版だけを承認できます。未承認では書き出しできません。" />
      {notice ? <p role="status" style={{ marginBottom: 12, padding: 10, background: "var(--color-success-soft)", border: "1px solid var(--color-success)", borderRadius: 8, fontSize: 13 }}>{notice}</p> : null}
      {error ? <p className="error-box" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}

      {overview ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card__header"><h2 className="card__title">8系統×variant 比較(overview)</h2></div>
          <div className="card__body" style={{ overflowX: "auto" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/api/template-previews/overview.png" alt="4系統×2variantの表紙を並べた比較" style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }} />
          </div>
        </section>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {items?.map((it) => {
          const cur = sel[it.templateId] ?? it.variants[0]?.variant ?? "";
          const entry = it.variants.find((v) => v.variant === cur) ?? it.variants[0] ?? null;
          const pv = entry?.preview ?? null;
          const allViewed = it.variants.every((v) => viewed[it.templateId]?.has(v.variant));
          return (
            <section key={it.templateId} className="card">
              <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 className="card__title">{it.family} <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>({it.templateId} v{it.version})</span></h2>
                <span style={{ fontSize: 12.5, fontWeight: 700, padding: "4px 12px", borderRadius: 999, background: it.status === "approved" ? "var(--color-success-soft)" : it.status === "rejected" ? "var(--color-danger-soft)" : "var(--color-surface-muted)", color: it.status === "approved" ? "var(--color-success)" : it.status === "rejected" ? "var(--color-danger)" : "var(--color-text-muted)" }}>{STATUS_LABEL[it.status] ?? it.status}</span>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 12 }}>
                {/* いま公開(書き出し)に使われる版を明示する(承認したのに未承認と言われる混乱の防止) */}
                {it.version !== null && it.publishVersion !== null && it.publishVersion !== it.version ? (
                  <p style={{ fontSize: 12.5, margin: 0, padding: "8px 12px", borderRadius: 8, background: "var(--color-surface-muted)", color: "var(--color-text)" }}>
                    現在の投稿画像には承認済みの <strong>v{it.publishVersion}</strong> が使われています。この v{it.version} を承認すると、以後の投稿は v{it.version} で作られます。
                  </p>
                ) : it.version !== null && it.publishVersion === null ? (
                  <p style={{ fontSize: 12.5, margin: 0, padding: "8px 12px", borderRadius: 8, background: "var(--color-danger-soft)", color: "var(--color-danger)" }}>
                    公開に使える承認済みの版がありません。この v{it.version} が承認されるまで、このテンプレートの投稿は書き出しできません。
                  </p>
                ) : it.version !== null && it.publishVersion === it.version ? (
                  <p style={{ fontSize: 12.5, margin: 0, padding: "8px 12px", borderRadius: 8, background: "var(--color-success-soft)", color: "var(--color-success)" }}>
                    この v{it.version} が現在の公開(書き出し)に使われています。
                  </p>
                ) : null}
                {/* variantタブ */}
                <div role="tablist" aria-label={`${it.family} のvariant`} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {it.variants.map((v) => (
                    <button key={v.variant} type="button" role="tab" aria-selected={v.variant === cur}
                      onClick={() => selectVariant(it.templateId, v.variant)}
                      className={`btn btn--sm ${v.variant === cur ? "btn--primary" : "btn--secondary"}`}>
                      {v.variant}{viewed[it.templateId]?.has(v.variant) ? " ✓" : " ・未確認"}
                    </button>
                  ))}
                </div>

                {pv ? (
                  <>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                      {pv.files.map((f, i) => (
                        <button key={f} type="button" onClick={() => setZoom({ tpl: it.templateId, version: it.version!, variant: cur, page: i, total: pv.files.length })} aria-label={`${it.family} ${cur} ${i + 1}枚目を拡大`} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: 0, background: "none", cursor: "pointer", flexShrink: 0 }}>
                          {/* スマホ相当270×338縮小 eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imgUrl(it.templateId, it.version!, cur, f)} alt={`${it.family} ${cur} ${i + 1}枚目`} width={135} height={169} style={{ display: "block", borderRadius: 8 }} />
                        </button>
                      ))}
                    </div>
                    <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, fontSize: 12.5, margin: 0 }}>
                      <Meta label="ページ数" value={`${pv.pageCount}枚`} />
                      <Meta label="fixture" value={pv.fixtureKind === "fictional" ? "架空データ" : "実データ"} />
                      <Meta label="fingerprint" value={pv.fingerprint.slice(0, 12) + "…"} />
                      <Meta label="content QA" value={qaBadge(entry?.qa?.contentQaResult ?? null)} ok={entry?.qa?.contentQaResult === "pass"} />
                      <Meta label="design QA" value={qaBadge(entry?.qa?.mechanicalQaResult ?? null)} ok={entry?.qa?.mechanicalQaResult === "pass"} />
                      <Meta label="visual QA(紫苑)" value={qaBadge(entry?.qa?.visualQaResult ?? null)} ok={entry?.qa?.visualQaResult === "pass"} />
                    </dl>
                    {pv.designQa.failures.length > 0 ? <p className="error-box" role="alert" style={{ fontSize: 12.5 }}>design QA指摘: {pv.designQa.failures.join(" / ")}</p> : null}
                    <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>権利: {pv.rights}</p>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>この variant のプレビューがありません。<code>pnpm company template-preview --all --version {it.version}</code> を実行してください。</p>
                )}

                {!it.approvability.ok ? (
                  <p style={{ fontSize: 12.5, color: "var(--color-warning)", margin: 0 }}>承認条件が未達: {it.approvability.failures.map((f) => `${f.variant}(${f.reason})`).join(" / ")}</p>
                ) : !allViewed ? (
                  <p style={{ fontSize: 12.5, color: "var(--color-warning)", margin: 0 }}>承認前に全variantを確認してください(未確認のvariantが残っています)。</p>
                ) : null}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
                  <button type="button" disabled={busy === it.templateId || !it.approvability.ok || !allViewed} onClick={() => void decide(it, "approved")} className="btn btn--primary">このテンプレートを承認</button>
                  <button type="button" disabled={busy === it.templateId} onClick={() => void decide(it, "revision_requested")} className="btn btn--secondary">修正依頼(理由必須)</button>
                  <button type="button" disabled={busy === it.templateId} onClick={() => void decide(it, "rejected")} className="btn btn--secondary" style={{ color: "var(--color-danger)" }}>却下(理由必須)</button>
                </div>
                {it.note ? <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>メモ: {it.note}</p> : null}
              </div>
            </section>
          );
        })}
      </div>

      {zoom ? (
        <div role="dialog" aria-label="テンプレート拡大表示" onClick={() => setZoom(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setZoom(null);
            if (e.key === "ArrowRight") setZoom((z) => (z ? { ...z, page: Math.min(z.total - 1, z.page + 1) } : z));
            if (e.key === "ArrowLeft") setZoom((z) => (z ? { ...z, page: Math.max(0, z.page - 1) } : z));
          }} tabIndex={-1}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, zIndex: 100 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgUrl(zoom.tpl, zoom.version, zoom.variant, `${String(zoom.page + 1).padStart(2, "0")}.png`)} alt={`${zoom.tpl} ${zoom.variant} ${zoom.page + 1}枚目 拡大`} style={{ maxWidth: "min(520px, 90vw)", maxHeight: "80vh", borderRadius: 12 }} />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setZoom((z) => (z ? { ...z, page: Math.max(0, z.page - 1) } : z))} aria-label="前のページ">←</button>
            <span style={{ color: "#fff", fontSize: 14 }}>{zoom.page + 1} / {zoom.total}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setZoom((z) => (z ? { ...z, page: Math.min(z.total - 1, z.page + 1) } : z))} aria-label="次のページ">→</button>
          </div>
          <button type="button" onClick={() => setZoom(null)} aria-label="閉じる" style={{ position: "fixed", top: 20, right: 24, fontSize: 28, background: "none", border: "none", color: "#fff", cursor: "pointer" }}>×</button>
        </div>
      ) : null}
    </AppShell>
  );
}

function Meta({ label, value, ok }: { label: string; value: string; ok?: boolean }): JSX.Element {
  return (
    <div style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
      <dt style={{ color: "var(--color-text-muted)" }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 700, color: ok === undefined ? "var(--color-text)" : ok ? "var(--color-success)" : "var(--color-danger)" }}>{value}</dd>
    </div>
  );
}
