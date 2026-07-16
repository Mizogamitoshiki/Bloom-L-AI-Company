"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import type { PortfolioView } from "@adapters/db/store";
import { AppShell, PageHeader } from "@/components/AppShell";

const STATUS_LABEL: Record<string, string> = {
  pending: "許可待ち(pending)",
  approved: "許可済み(approved)",
  rejected: "拒否(rejected)",
  revoked: "取り消し(revoked)",
};

/** S-06 実績素材・公開許可管理(V3-C)。登録・許可の記録は代表者のみ。証跡ファイルは配信しない */
export default function PortfolioPage(): JSX.Element {
  const [items, setItems] = useState<PortfolioView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ customerName: "", siteUrl: "", anonymousName: "", summary: "", problem: "", technologies: "" });

  const [evidenceFiles, setEvidenceFiles] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setItems(json as PortfolioView[]);
      const ev = await fetch("/api/portfolio/evidence-files", { cache: "no-store" });
      if (ev.ok) setEvidenceFiles(((await ev.json()) as { files: string[] }).files);
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
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({
          customerName: form.customerName,
          siteUrl: form.siteUrl || undefined,
          anonymousName: form.anonymousName || undefined,
          summary: form.summary || undefined,
          problem: form.problem || undefined,
          technologies: form.technologies ? form.technologies.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "登録に失敗しました");
      setNotice("実績を登録しました(公開許可は pending から始まります)");
      setForm({ customerName: "", siteUrl: "", anonymousName: "", summary: "", problem: "", technologies: "" });
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function uploadAsset(e: React.FormEvent<HTMLFormElement>, itemId: string): Promise<void> {
    e.preventDefault();
    try {
      const formData = new FormData(e.currentTarget);
      const res = await fetch(`/api/portfolio/${itemId}/assets`, {
        method: "POST",
        headers: { "x-bloom-owner-action": "confirmed-in-ui" },
        body: formData,
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "画像の登録に失敗しました");
      setNotice("実績画像を安全領域へ登録しました。投稿で使うには許可範囲の「画面キャプチャ」も有効にしてください");
      e.currentTarget.reset();
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  // 許可編集フォームの状態(permissionIdごと)
  const [editPermId, setEditPermId] = useState<string | null>(null);
  const [permForm, setPermForm] = useState({
    name: false,
    url: false,
    screenshot: false,
    testimonial: false,
    anonymousAllowed: false,
    evidencePath: "",
  });

  async function submitPermission(permissionId: string, status: "approved" | "pending" | "revoked" | "rejected"): Promise<void> {
    try {
      const res = await fetch(`/api/portfolio/${permissionId}/permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({
          status,
          anonymousAllowed: permForm.anonymousAllowed,
          evidencePath: permForm.evidencePath.trim() || undefined,
          // approved時は4項目を個別指定(一括固定scopeは廃止・V3レビュー指摘1)
          scope:
            status === "approved"
              ? { name: permForm.name, url: permForm.url, screenshot: permForm.screenshot, testimonial: permForm.testimonial }
              : undefined,
        }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "更新に失敗しました");
      setNotice("公開許可を更新しました(監査ログに記録)。承認待ち投稿がある場合は再QA・再レンダリングが必要になることがあります");
      setEditPermId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <AppShell current="/portfolio" title="制作実績と公開許可">
      <PageHeader title="制作実績と公開許可" subtitle="登録・許可の記録は代表者のみ。証跡ファイルは配信しません。" />
      {notice ? <p role="status" style={{ margin: 16, padding: 8, background: "#eef7ee", border: "1.5px solid var(--color-success)", borderRadius: 4 }}>{notice}</p> : null}
      {error ? <p className="error-box" style={{ margin: 16 }} role="alert">{error}</p> : null}

      <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <section aria-label="実績一覧" style={{ background: "#fff", border: "2px solid var(--color-wall)", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>登録済み実績({items?.length ?? "…"}件)</h2>
          {items && items.length === 0 ? (
            <p style={{ fontSize: 13 }}>
              まだ実績が登録されていません。HP制作実績3件は下のフォームから登録してください(顧客名・URL等は実際の値を代表者が入力します。
              登録直後の許可状態は pending で、許可を記録するまで投稿には使用されません)。
            </p>
          ) : null}
          {items?.map(({ item, permission, rights }) => (
            <div key={item.id} style={{ border: "1px solid var(--color-wall)", borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <strong>{item.customerName}</strong>
              {item.anonymousName ? <span style={{ color: "var(--color-ink-muted)" }}>(匿名名: {item.anonymousName})</span> : null}
              {item.siteUrl ? <> — <a href={item.siteUrl} target="_blank" rel="noreferrer">{item.siteUrl}</a></> : null}
              <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>実績ID: {item.id}</div>
              <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>
                実績画像: {item.assetsPath ?? "未登録"}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                許可状態:{" "}
                <strong style={{ color: permission?.status === "approved" ? "var(--color-success)" : "var(--color-warning)" }}>
                  {STATUS_LABEL[permission?.status ?? "pending"]}
                </strong>
                {permission?.anonymousAllowed ? "(匿名利用可)" : "(匿名利用不可)"}
                {permission?.grantedAt ? ` / 取得日: ${permission.grantedAt}` : ""}
                {permission?.evidencePath ? ` / 証跡: ${permission.evidencePath}` : " / 証跡: 未登録"}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>
                許可範囲: {["name:実名", "url:URL", "screenshot:画像", "testimonial:声"]
                  .map((pair) => {
                    const [key, label] = pair.split(":") as [string, string];
                    const scope = (() => {
                      try {
                        return JSON.parse(permission?.scopeJson ?? "{}") as Record<string, boolean>;
                      } catch {
                        return {} as Record<string, boolean>;
                      }
                    })();
                    return `${label}${scope[key] ? "○" : "✕"}`;
                  })
                  .join(" ")}
              </div>
              <div style={{ fontSize: 13, marginTop: 2 }}>
                投稿での利用可否: {rights.allowed ? `可(${rights.mode === "anonymous" ? "匿名" : "実名"}: ${rights.displayName})` : `不可 — ${rights.reason}`}
              </div>
              <form onSubmit={(e) => void uploadAsset(e, item.id)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <label style={{ fontSize: 13 }}>
                  HP画面キャプチャ(PNG/JPEG/WebP・20MB以下)
                  <input name="file" type="file" accept="image/png,image/jpeg,image/webp" required style={{ display: "block", marginTop: 4 }} />
                </label>
                <button type="submit" className="btn-secondary">画像を登録・差し替え</button>
              </form>
              {permission ? (
                editPermId === permission.id ? (
                  <fieldset style={{ marginTop: 8, border: "1px solid var(--color-wall)", borderRadius: 6, padding: 10 }}>
                    <legend style={{ fontSize: 13, fontWeight: 700 }}>許可範囲の記録(4項目を個別に選択)</legend>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
                      {(
                        [
                          ["name", "顧客名(実名)"],
                          ["url", "URL"],
                          ["screenshot", "画面キャプチャ"],
                          ["testimonial", "お客様の声"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={permForm[key]}
                            onChange={(e) => setPermForm({ ...permForm, [key]: e.target.checked })}
                          />{" "}
                          {label}
                        </label>
                      ))}
                      <label>
                        <input
                          type="checkbox"
                          checked={permForm.anonymousAllowed}
                          onChange={(e) => setPermForm({ ...permForm, anonymousAllowed: e.target.checked })}
                        />{" "}
                        匿名利用を許可
                      </label>
                    </div>
                    <label style={{ display: "block", fontSize: 13, marginTop: 8 }}>
                      許可証跡ファイル(approved・匿名許可に必須。data/workspace/07_customer-permissions/ に保存済みのファイルから選択。内容は配信されません)
                      <input
                        list="evidence-files"
                        value={permForm.evidencePath}
                        onChange={(e) => setPermForm({ ...permForm, evidencePath: e.target.value })}
                        placeholder="07_customer-permissions/(顧客名)-同意DM.png"
                        style={{ display: "block", width: "100%", font: "inherit", padding: 6, border: "2px solid var(--color-wall)", borderRadius: 4 }}
                      />
                      <datalist id="evidence-files">
                        {evidenceFiles.map((f) => (
                          <option key={f} value={f} />
                        ))}
                      </datalist>
                      {evidenceFiles.length === 0 ? (
                        <span style={{ color: "var(--color-warning)" }}>
                          証跡ファイルが見つかりません。先に同意DMのスクリーンショット等を上記フォルダへ保存してください(実在しないパスは登録できません)
                        </span>
                      ) : null}
                    </label>
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn-secondary" onClick={() => void submitPermission(permission.id, "approved")}>
                        承認として記録(approved)
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => void submitPermission(permission.id, "pending")}>
                        pendingのまま保存(匿名許可など)
                      </button>
                      <button type="button" className="btn-danger" onClick={() => void submitPermission(permission.id, "revoked")}>
                        取り消し(revoked)
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setEditPermId(null)}>
                        閉じる
                      </button>
                    </div>
                  </fieldset>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setEditPermId(permission.id);
                        const scope = (() => {
                          try {
                            return JSON.parse(permission.scopeJson ?? "{}") as Record<string, boolean>;
                          } catch {
                            return {};
                          }
                        })();
                        setPermForm({
                          name: !!scope.name,
                          url: !!scope.url,
                          screenshot: !!scope.screenshot,
                          testimonial: !!scope.testimonial,
                          anonymousAllowed: permission.anonymousAllowed === 1,
                          evidencePath: permission.evidencePath ?? "",
                        });
                      }}
                    >
                      許可範囲を編集
                    </button>
                  </div>
                )
              ) : null}
            </div>
          ))}
        </section>

        <section aria-label="実績の登録" style={{ background: "#fff", border: "2px solid var(--color-wall)", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>実績を登録(代表者)</h2>
          <form onSubmit={(e) => void register(e)} style={{ display: "grid", gap: 8, maxWidth: 560 }}>
            {(
              [
                ["customerName", "顧客名(必須)"],
                ["siteUrl", "顧客URL"],
                ["anonymousName", "匿名表示名(例: 泉州の飲食店さま)"],
                ["summary", "概要"],
                ["problem", "解決した課題"],
                ["technologies", "使用技術(カンマ区切り)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={{ fontSize: 13 }}>
                {label}
                <input
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  required={key === "customerName"}
                  style={{ display: "block", width: "100%", font: "inherit", padding: 6, border: "2px solid var(--color-wall)", borderRadius: 4 }}
                />
              </label>
            ))}
            <button type="submit" className="btn-secondary" style={{ justifySelf: "start" }}>
              登録する(許可状態はpendingで開始)
            </button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
