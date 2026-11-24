"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { SampleRequestView, SiteSampleRow } from "@adapters/db/samples";
import { AppShell, PageHeader } from "@/components/AppShell";

const STATUS_LABEL: Record<string, string> = {
  new: "素材待ち/受付",
  building: "制作中",
  qa: "画面QA中",
  ready: "投稿可能",
  posted: "投稿済み",
  declined: "見送り",
};
/** 既存の .badge[data-state] 配色へ対応付け(色+テキストの多重表現) */
const STATUS_STATE: Record<string, string> = {
  new: "idle",
  building: "creating",
  qa: "qa",
  ready: "awaiting_approval",
  posted: "done_today",
  declined: "error",
};
const PERSONA_LABEL: Record<string, string> = {
  P1: "P1=製造・建設の2代目",
  P2: "P2=店舗オーナー",
  P3: "P3=一人親方・士業・教室",
};
const PLAN_LABEL: Record<string, string> = { auto: "おまかせ", ume: "梅", take: "竹", matsu: "松" };
const KIND_LABEL: Record<string, string> = {
  design: "再現対象デザイン",
  hero: "メイン画像",
  logo: "ロゴ",
  photo: "写真",
  reference: "参考(画面に出さない)",
};
const SHOT_LABEL: Record<string, string> = {
  "pc-fold": "PC ファーストビュー",
  "pc-full": "PC 全体",
  "sp-fold": "スマホ ファーストビュー",
  "sp-full": "スマホ 全体",
};
const QA_LABEL: Record<string, string> = { pass: "合格", fail: "差し戻し" };

const ATTEST_TEXT =
  "これらの画像は私(Bloom-L)が権利を持つ、または商用利用可能なライセンスで取得したもので、実在の第三者の写真・ロゴ・著作物・他社サイトの画面を含みません(再現対象のデザインは自分で作成したものです)";

interface ScreenshotRef {
  name: string;
  sha256: string;
  width: number;
  height: number;
  safeRelativePath: string;
}

const inputStyle = { display: "block", width: "100%", font: "inherit", padding: 6, border: "2px solid var(--color-wall)", borderRadius: 4 } as const;
const sectionStyle = { background: "#fff", border: "2px solid var(--color-wall)", borderRadius: 8, padding: 16 } as const;

function fileUrl(safeRelativePath: string): string {
  return `/api/samples/file/${safeRelativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function parseJsonArray<T>(json: string | null | undefined): T[] {
  try {
    const v: unknown = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function LatestSample({ sample }: { sample: SiteSampleRow }): JSX.Element {
  const shots = parseJsonArray<ScreenshotRef>(sample.screenshotsJson);
  const qaLabel = sample.designQaResult ? (QA_LABEL[sample.designQaResult] ?? sample.designQaResult) : "未実施";
  const qaColor =
    sample.designQaResult === "pass" ? "var(--color-success)" : sample.designQaResult === "fail" ? "var(--color-danger)" : "var(--color-warning)";
  return (
    <div style={{ marginTop: 10, border: "1px solid var(--color-wall)", borderRadius: 6, padding: 10, background: "var(--color-primary-softer, #f7f8fb)" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <strong>最新サンプル v{sample.version}</strong>
        <span>
          忠実度QA: <strong style={{ color: qaColor }}>{qaLabel}</strong>
        </span>
        <span>
          プラン適合: {PLAN_LABEL[sample.planFit] ?? sample.planFit}
          {sample.planFitReason ? <span style={{ color: "var(--color-ink-muted)" }}>({sample.planFitReason})</span> : null}
        </span>
        <a
          className="btn btn--secondary btn--sm"
          href={`${fileUrl(sample.dirPath)}/index.html`}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: "auto" }}
        >
          サンプルを開く
        </a>
      </div>
      {sample.concept ? <div style={{ fontSize: 12, color: "var(--color-ink-muted)", marginTop: 4 }}>コンセプト: {sample.concept}</div> : null}
      {sample.deployUrl ? (
        <div style={{ fontSize: 12, marginTop: 4 }}>
          公開URL:{" "}
          <a href={sample.deployUrl} target="_blank" rel="noreferrer">
            {sample.deployUrl}
          </a>
          {sample.deployedAt ? `(${sample.deployedAt})` : ""}
        </div>
      ) : null}
      {shots.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginTop: 8 }}>
          {shots.map((s) => (
            <figure key={s.name} style={{ margin: 0, fontSize: 11 }}>
              <a href={fileUrl(s.safeRelativePath)} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(s.safeRelativePath)}
                  alt={`${SHOT_LABEL[s.name] ?? s.name} の撮影画像`}
                  style={{ width: "100%", maxHeight: 220, objectFit: "cover", objectPosition: "top", border: "1px solid var(--color-wall)", borderRadius: 4, background: "#fff" }}
                />
              </a>
              <figcaption>
                {SHOT_LABEL[s.name] ?? s.name}
                <span style={{ color: "var(--color-ink-muted)" }}>
                  {" "}
                  {s.width}×{s.height}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: "6px 0 0" }}>撮影画像はまだありません</p>
      )}
    </div>
  );
}

/** S-12 サイトサンプル(V10.2)。素材投入・見送りは代表者のみ。制作は昼シフト(/noon-run)で颯が行う */
export default function SamplesPage(): JSX.Element {
  const [items, setItems] = useState<SampleRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    siteTitle: "",
    industry: "",
    persona: "P1",
    planTarget: "auto",
    pages: "TOP",
    brief: "",
    attest: false,
  });
  const [declineReason, setDeclineReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/samples", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setItems(json as SampleRequestView[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function register(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!form.attest) {
      setError("素材の権利宣言にチェックを入れてください");
      return;
    }
    setBusy(true);
    try {
      const pages = form.pages
        .split(/[,、，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/samples", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({
          slug: form.slug.trim(),
          siteTitle: form.siteTitle.trim() || undefined,
          industry: form.industry.trim(),
          persona: form.persona,
          planTarget: form.planTarget,
          pages: pages.length > 0 ? pages : ["TOP"],
          brief: form.brief,
          attest: form.attest === true ? true : undefined,
        }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "登録に失敗しました");
      setNotice("サンプル依頼を登録しました。続けて素材(再現対象デザイン・ロゴ・写真など)を投入してください");
      setForm({ slug: "", siteTitle: "", industry: "", persona: "P1", planTarget: "auto", pages: "TOP", brief: "", attest: false });
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAsset(e: React.FormEvent<HTMLFormElement>, requestId: string): Promise<void> {
    e.preventDefault();
    const formEl = e.currentTarget;
    try {
      const formData = new FormData(formEl);
      const res = await fetch(`/api/samples/${requestId}/assets`, {
        method: "POST",
        headers: { "x-bloom-owner-action": "confirmed-in-ui" },
        body: formData,
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "素材の登録に失敗しました");
      setNotice("素材を安全領域(02_site-samples)へ登録しました");
      formEl.reset();
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function decline(requestId: string): Promise<void> {
    const reason = (declineReason[requestId] ?? "").trim();
    if (!reason) {
      setError("見送りには理由が必要です");
      return;
    }
    try {
      const res = await fetch(`/api/samples/${requestId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ reason }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "見送りに失敗しました");
      setNotice("依頼を見送りにしました(監査ログに記録。素材ファイルは削除されません)");
      setDeclineReason({ ...declineReason, [requestId]: "" });
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  return (
    <AppShell current="/samples" title="サイトサンプル">
      <PageHeader title="サイトサンプル" subtitle="架空のHPサンプルを1日1件制作し、投稿へつなげます。素材投入・見送りは代表者のみ。" />
      {notice ? <p role="status" style={{ margin: 16, padding: 8, background: "#eef7ee", border: "1.5px solid var(--color-success)", borderRadius: 4 }}>{notice}</p> : null}
      {error ? <p className="error-box" style={{ margin: 16 }} role="alert">{error}</p> : null}

      <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <section aria-label="流れの説明" style={{ ...sectionStyle, background: "var(--color-primary-softer, #f7f8fb)" }}>
          <h2 style={{ marginTop: 0, fontSize: 15 }}>サンプル制作の流れ</h2>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.9 }}>
            <li>素材投入(このページ) — 再現対象デザイン・ロゴ・写真などを権利宣言つきで登録</li>
            <li>昼シフト(/noon-run)で颯がサンプルサイトを制作(外部リソース・JS・実在情報・価格は通常コードが拒否)</li>
            <li>紬の忠実度QA(PC/スマホの撮影4枚を再現対象デザインと照合。fail closed)</li>
            <li>投稿(承認キュー) — tpl-sample投稿として /approvals へ</li>
            <li>承認後に代表者がデプロイ(同一ドメインで公開)</li>
          </ol>
          <p style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: "8px 0 0" }}>
            「参考(reference)」種別の画像は雰囲気の参考にのみ使い、画面には出しません。他社サイトの画面・第三者の著作物は種別を問わず投入できません。
          </p>
        </section>

        <section aria-label="サンプル依頼の登録" style={sectionStyle}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>サンプル依頼を登録(代表者)</h2>
          <form onSubmit={(e) => void register(e)} style={{ display: "grid", gap: 8, maxWidth: 640 }}>
            <label style={{ fontSize: 13 }}>
              slug(必須・英小文字/数字/ハイフン 3〜40字。フォルダ名・URLに使用)
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                required
                pattern="[a-z0-9][a-z0-9-]{2,39}"
                placeholder="例: senshu-koumuten"
                style={inputStyle}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              架空の屋号(任意・40字以内。空なら颯が命名し「(サンプル)」を自動付与)
              <input value={form.siteTitle} onChange={(e) => setForm({ ...form, siteTitle: e.target.value })} maxLength={40} style={inputStyle} />
            </label>
            <label style={{ fontSize: 13 }}>
              業種(必須・80字以内)
              <input
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                required
                maxLength={80}
                placeholder="例: 泉州の工務店(注文住宅・リフォーム)"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ fontSize: 13 }}>
                ペルソナ
                <select value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} style={inputStyle}>
                  {(["P1", "P2", "P3"] as const).map((p) => (
                    <option key={p} value={p}>
                      {PERSONA_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                狙うプラン
                <select value={form.planTarget} onChange={(e) => setForm({ ...form, planTarget: e.target.value })} style={inputStyle}>
                  {(["auto", "ume", "take", "matsu"] as const).map((p) => (
                    <option key={p} value={p}>
                      {PLAN_LABEL[p]}({p})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ fontSize: 13 }}>
              ページ構成(カンマ区切り・TOP必須・最大3ページ)
              <input value={form.pages} onChange={(e) => setForm({ ...form, pages: e.target.value })} placeholder="TOP, サービス, お問い合わせ" style={inputStyle} />
            </label>
            <label style={{ fontSize: 13 }}>
              参考メモ(1000字以内・任意)
              <textarea
                value={form.brief}
                onChange={(e) => setForm({ ...form, brief: e.target.value })}
                maxLength={1000}
                rows={4}
                placeholder="雰囲気・見せたい強み・避けたい表現など"
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </label>
            <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start", padding: 8, border: "1px solid var(--color-warning)", borderRadius: 4, background: "var(--color-warning-soft, #fff8e6)" }}>
              <input type="checkbox" checked={form.attest} onChange={(e) => setForm({ ...form, attest: e.target.checked })} required style={{ marginTop: 3 }} />
              <span>
                <strong>素材の権利宣言(必須)</strong>
                <br />
                {ATTEST_TEXT}
              </span>
            </label>
            <button type="submit" className="btn btn--primary" disabled={!form.attest || busy} style={{ justifySelf: "start" }}>
              {busy ? "登録中…" : "依頼を登録する(status: new)"}
            </button>
          </form>
        </section>

        <section aria-label="サンプル依頼一覧" style={sectionStyle}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>サンプル依頼({items?.length ?? "…"}件・新しい順)</h2>
          {items === null ? <p style={{ fontSize: 13 }}>読み込み中…</p> : null}
          {items && items.length === 0 ? <p style={{ fontSize: 13 }}>まだ依頼がありません。上のフォームから登録し、素材を投入してください。</p> : null}
          {items?.map(({ request, assets, latestSample }) => {
            const pages = parseJsonArray<string>(request.pagesJson);
            const closed = request.status === "posted" || request.status === "declined";
            return (
              <div key={request.id} style={{ border: "1px solid var(--color-wall)", borderRadius: 6, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="badge" data-state={STATUS_STATE[request.status] ?? "idle"}>
                    {STATUS_LABEL[request.status] ?? request.status}
                  </span>
                  <strong>{request.siteTitle || "(屋号未定・颯が命名)"}</strong>
                  <code style={{ fontSize: 12 }}>{request.slug}</code>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-ink-muted)", marginTop: 2 }}>
                  依頼ID: {request.id} / 登録: {request.createdAt}
                  {request.attestedAt ? ` / 権利宣言: ${request.attestedAt}(${request.attestedBy ?? "owner"})` : ""}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  業種: {request.industry} / ペルソナ: {PERSONA_LABEL[request.persona] ?? request.persona} / プラン: {PLAN_LABEL[request.planTarget] ?? request.planTarget}
                  {pages.length > 0 ? ` / ページ: ${pages.join("・")}` : ""}
                </div>
                {request.brief ? <div style={{ fontSize: 13, marginTop: 2, whiteSpace: "pre-wrap" }}>{request.brief}</div> : null}
                {request.status === "declined" && request.declineReason ? (
                  <div style={{ fontSize: 13, marginTop: 2, color: "var(--color-danger)" }}>見送り理由: {request.declineReason}</div>
                ) : null}

                <div style={{ fontSize: 13, marginTop: 8 }}>素材({assets.length}件)</div>
                {assets.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--color-ink-muted)", margin: "2px 0 0" }}>
                    まだ素材がありません。再現対象デザイン(design)を1枚以上投入すると制作対象になります。
                  </p>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginTop: 4 }}>
                    {assets.map((a) => (
                      <figure key={a.id} style={{ margin: 0, fontSize: 11 }}>
                        <a href={fileUrl(a.safeRelativePath)} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={fileUrl(a.safeRelativePath)}
                            alt={`${KIND_LABEL[a.kind] ?? a.kind}: ${a.fileName}`}
                            style={{ width: "100%", height: 90, objectFit: "cover", border: "1px solid var(--color-wall)", borderRadius: 4, background: "#fff" }}
                          />
                        </a>
                        <figcaption>
                          <strong>{KIND_LABEL[a.kind] ?? a.kind}</strong>
                          <br />
                          <span style={{ color: "var(--color-ink-muted)" }}>
                            {a.width}×{a.height} / {Math.round(a.bytes / 1024)}KB
                          </span>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}

                {!closed ? (
                  <form onSubmit={(e) => void uploadAsset(e, request.id)} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8 }}>
                    <label style={{ fontSize: 13 }}>
                      素材画像(PNG/JPEG/WebP・20MB以下)
                      <input name="file" type="file" accept="image/png,image/jpeg,image/webp" required style={{ display: "block", marginTop: 4 }} />
                    </label>
                    <label style={{ fontSize: 13 }}>
                      種別
                      <select name="kind" defaultValue="design" style={{ ...inputStyle, width: "auto", marginTop: 4 }}>
                        {(["design", "hero", "logo", "photo", "reference"] as const).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="btn-secondary">素材を追加</button>
                  </form>
                ) : null}

                {latestSample ? <LatestSample sample={latestSample} /> : null}

                {!closed ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <input
                      value={declineReason[request.id] ?? ""}
                      onChange={(e) => setDeclineReason({ ...declineReason, [request.id]: e.target.value })}
                      placeholder="見送り理由(必須)"
                      maxLength={500}
                      aria-label={`${request.slug} の見送り理由`}
                      style={{ ...inputStyle, width: 320, maxWidth: "100%" }}
                    />
                    <button type="button" className="btn-danger" disabled={!(declineReason[request.id] ?? "").trim()} onClick={() => void decline(request.id)}>
                      見送りにする
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
