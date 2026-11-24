"use client";
import { useCallback, useEffect, useState, type JSX } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";

interface StoryItem {
  name: string;
  url: string;
  bytes: number;
  updatedAt: string;
}

/**
 * S-11 Instagramストーリー(V8/D-18)。Canvaで作成した縦長(1080x1920)ストーリー画像の一覧・確認・ダウンロード。
 * ストーリーは24hで消える簡易メディアのため、フィード投稿の承認パイプラインには載せず、
 * 代表者がここからダウンロードしてInstagramアプリで手動投稿する運用。
 */
export default function StoriesPage(): JSX.Element {
  const [items, setItems] = useState<StoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/stories", { cache: "no-store" });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "取得に失敗しました");
      setItems((json as { items: StoryItem[] }).items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function fmtKB(bytes: number): string {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return (
    <AppShell current="/stories" title="ストーリー">
      <PageHeader
        title="Instagramストーリー"
        subtitle="Canvaで作成した縦長(1080×1920)ストーリー画像。ここからダウンロードし、Instagramアプリで手動投稿します。"
      />

      <section className="card" style={{ marginBottom: 20 }}>
        <h2 className="card__title">ストーリーの投稿手順</h2>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.9 }}>
          <li>下の一覧から投稿したいストーリーの「ダウンロード」を押してスマホ/PCに保存</li>
          <li>Instagramアプリを開き、ストーリー作成 → 保存した画像を選択</li>
          <li>必要に応じてスタンプ・リンク(DM誘導など)を追加して投稿</li>
        </ol>
        <p style={{ margin: "10px 0 0", color: "var(--ink-muted, #5a6478)", fontSize: 14 }}>
          ※ ストーリーは24時間で消える簡易メディアのため、フィード投稿の承認フローとは分けています。新しいストーリーはCanvaで作成後、自動的にここへ追加されます。
        </p>
      </section>

      {error ? (
        <p className="error-box" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p>読み込み中…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>まだストーリーがありません。Canvaで作成すると、ここに表示されます。</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 20,
          }}
        >
          {items.map((s) => (
            <div key={s.name} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "9 / 16",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "#0f1c33",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.url}
                  alt={s.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-muted, #5a6478)" }}>
                {fmtDate(s.updatedAt)} ・ {fmtKB(s.bytes)}
              </div>
              <a
                className="btn btn--primary"
                href={s.url}
                download={s.name}
                style={{ textAlign: "center", textDecoration: "none" }}
              >
                ダウンロード
              </a>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
