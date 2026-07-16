"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";

interface SettingsData {
  operation: { weeklyPostTarget: number; ownerDailyMinutes: number; timezone: string };
  refs: {
    limits: Record<string, Record<string, number>>;
    modelProfiles: unknown;
    brand: { placeholder: boolean; logoPresent: boolean; manifest: { updatedAt?: string; rights?: string } | null };
    apiEnabled: boolean;
    instagram: { mode: "disabled" | "dry_run" | "live"; liveReady: boolean; missing: string[] };
  };
}

/** S-10 設定。運用設定のみ編集可(owner)。limits/model-profiles/brandは参照表示。APIキー入力欄は作らない(V4-D) */
export default function SettingsPage(): JSX.Element {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ weeklyPostTarget: 3, ownerDailyMinutes: 30 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      const d = json as SettingsData;
      setData(d);
      setForm({ weeklyPostTarget: d.operation.weeklyPostTarget, ownerDailyMinutes: d.operation.ownerDailyMinutes });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bloom-owner-action": "confirmed-in-ui" },
        body: JSON.stringify({ ...form, timezone: "Asia/Tokyo" }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "保存に失敗しました");
      setNotice("運用設定を保存しました(監査ログに記録)。");
      await load();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell current="/settings" title="設定">
      <PageHeader title="設定" subtitle="運用設定のみ編集できます。しきい値・モデル・ブランドは参照表示(V4ではファイルを直接編集しません)。" />
      {notice ? <p role="status" style={{ marginBottom: 12, padding: 10, background: "var(--color-success-soft)", border: "1px solid var(--color-success)", borderRadius: 8, fontSize: 13 }}>{notice}</p> : null}
      {error ? <p className="error-box" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}

      {data ? (
        <div style={{ maxWidth: 760, display: "grid", gap: 14 }}>
          <section className="card">
            <div className="card__header"><h2 className="card__title">運用設定(編集可)</h2></div>
            <div className="card__body">
              <form onSubmit={(e) => void save(e)} style={{ display: "grid", gap: 12, maxWidth: 420 }}>
                <label style={{ fontSize: 13 }}>
                  週の投稿目標(1〜7本)
                  <input
                    type="number" min={1} max={7} value={form.weeklyPostTarget}
                    onChange={(e) => setForm({ ...form, weeklyPostTarget: Number(e.target.value) })}
                    style={{ display: "block", width: "100%", font: "inherit", padding: 8, border: "1px solid var(--color-border-strong)", borderRadius: 6 }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  代表者の1日の作業時間(分・10〜120)
                  <input
                    type="number" min={10} max={120} value={form.ownerDailyMinutes}
                    onChange={(e) => setForm({ ...form, ownerDailyMinutes: Number(e.target.value) })}
                    style={{ display: "block", width: "100%", font: "inherit", padding: 8, border: "1px solid var(--color-border-strong)", borderRadius: 6 }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  タイムゾーン
                  <input value="Asia/Tokyo" readOnly disabled style={{ display: "block", width: "100%", font: "inherit", padding: 8, border: "1px solid var(--color-border)", borderRadius: 6, background: "var(--color-surface-muted)" }} />
                </label>
                <button type="submit" className="btn btn--primary" disabled={busy} style={{ justifySelf: "start" }}>保存する</button>
              </form>
            </div>
          </section>

          <section className="card">
            <div className="card__header"><h2 className="card__title">利用上限(参照・config/limits.yaml)</h2></div>
            <div className="card__body">
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, fontSize: 12.5, margin: 0 }}>
                {Object.entries(data.refs.limits.daily ?? {}).map(([k, v]) => (
                  <div key={k} style={{ background: "var(--color-surface-muted)", padding: 8, borderRadius: 6 }}>
                    <dt style={{ color: "var(--color-text-muted)" }}>{k}</dt>
                    <dd style={{ margin: 0, fontWeight: 700 }}>{String(v)}</dd>
                  </div>
                ))}
              </dl>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 0 }}>変更はconfig/limits.yamlを編集してください(UIからは変更しません)。</p>
            </div>
          </section>

          <section className="card">
            <div className="card__header"><h2 className="card__title">モデル / ブランド / API(参照)</h2></div>
            <div className="card__body" style={{ fontSize: 13, display: "grid", gap: 8 }}>
              <div>モデルプロファイル: <code>config/model-profiles.yaml</code>(参照元)</div>
              <div>ブランド: {data.refs.brand.placeholder ? "プレースホルダー" : "正式素材を反映"} / ロゴ {data.refs.brand.logoPresent ? "あり" : "なし"}{data.refs.brand.manifest?.updatedAt ? ` / 更新日 ${data.refs.brand.manifest.updatedAt}` : ""}</div>
              <div>Anthropic API: <strong>{data.refs.apiEnabled ? "有効" : "無効(既定)"}</strong></div>
              <div>Instagram公式API: <strong>{data.refs.instagram.liveReady ? "実投稿可能" : data.refs.instagram.mode === "dry_run" ? "ドライラン" : "無効/設定不足"}</strong> — 秘密情報は<code>.env</code>だけで管理し、画面に入力欄は設けません。</div>
            </div>
          </section>
        </div>
      ) : (
        <p>読み込み中…</p>
      )}
    </AppShell>
  );
}
