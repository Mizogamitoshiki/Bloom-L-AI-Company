"use client";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import {
  IconHome,
  IconStamp,
  IconKanban,
  IconCalendar,
  IconImage,
  IconReport,
  IconSettings,
  IconBell,
  IconQuestion,
  IconMenu,
  IconBuilding,
} from "./icons";
import { PixelAvatar } from "./PixelAvatar";

interface NavItem {
  href: string;
  label: string;
  Icon: (p: { size?: number }) => JSX.Element;
}

const NAV: NavItem[] = [
  { href: "/", label: "オフィス", Icon: IconHome },
  { href: "/approvals", label: "承認", Icon: IconStamp },
  { href: "/pipeline", label: "投稿パイプライン", Icon: IconKanban },
  { href: "/calendar", label: "カレンダー", Icon: IconCalendar },
  { href: "/portfolio", label: "実績素材", Icon: IconImage },
  { href: "/reports", label: "日報", Icon: IconReport },
];

/** ロゴ(正式ブランド画像。/api/brand/logo から配信、コード変更なしで差し替え可能) */
function BrandLogo(): JSX.Element {
  const [ok, setOk] = useState(true);
  return (
    <div className="sidebar__logo">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/api/brand/logo" alt="Bloom-L" onError={() => setOk(false)} />
      ) : (
        <span className="sidebar__logo-fallback" aria-label="Bloom-L">
          Bloom-L
        </span>
      )}
    </div>
  );
}

export interface TopBarInfo {
  statusLabel: string;
  paused?: { reason: string } | null;
  awaitingCount?: number;
  updatedAt?: string | null;
}

/**
 * 全画面共通シェル(Sidebar + TopBar)。機能・データは各ページのまま。
 * current は aria-current="page" を付けるパス。
 */
export function AppShell({
  current,
  title,
  topbar,
  onResume,
  children,
}: {
  current: string;
  title: string;
  topbar?: TopBarInfo;
  onResume?: () => void;
  children: ReactNode;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState<string>("");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ルート変更後は main へフォーカス(a11y)
  useEffect(() => {
    mainRef.current?.focus();
  }, [current]);

  return (
    <div className="app-shell">
      {menuOpen ? <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" /> : null}
      <nav className="sidebar" data-open={menuOpen} aria-label="主要ナビゲーション">
        <BrandLogo />
        <div className="nav">
          {NAV.map(({ href, label, Icon }) => (
            <a key={href} href={href} className="nav__item" aria-current={href === current ? "page" : undefined}>
              <Icon size={18} />
              {label}
            </a>
          ))}
        </div>
        <div className="sidebar__spacer" />
        <a href="/settings" className="nav__item" aria-current={current === "/settings" ? "page" : undefined}>
          <IconSettings size={18} />
          設定
        </a>
        <div className="sidebar__owner">
          <span className="side-row__avatar" aria-hidden="true">
            <PixelAvatar hue={215} ceo seed="bloom-manager" />
          </span>
          <span>
            <span className="sidebar__owner-name">マネージャー</span>
            <br />
            <span className="sidebar__owner-status">
              <span className="dot" />
              オンライン
            </span>
          </span>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar__menu-btn"
            aria-label="メニューを開く"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconMenu size={20} />
          </button>
          <span className="topbar__title">
            <IconBuilding size={18} />
            {title}
          </span>
          {topbar ? (
            <span className={`pill${topbar.paused ? " pill--paused" : ""}`} role="status">
              <span className="dot" />
              {topbar.paused ? "生成停止中" : topbar.statusLabel}
            </span>
          ) : null}
          <span className="topbar__spacer" />
          <span className="topbar__actions">
            {typeof topbar?.awaitingCount === "number" ? (
              <a className="icon-btn" href="/approvals" aria-label={`承認待ち ${topbar.awaitingCount}件`}>
                <IconBell size={20} />
                {topbar.awaitingCount > 0 ? <span className="icon-btn__badge">{topbar.awaitingCount}</span> : null}
              </a>
            ) : null}
            <a className="icon-btn" href="/reports" aria-label="ヘルプ・日報">
              <IconQuestion size={20} />
            </a>
            <span className="topbar__clock" aria-label="現在時刻">
              {clock}
            </span>
          </span>
        </header>

        {topbar?.paused ? (
          <div className="banner banner--warning" role="alert">
            <span>
              <strong>新規生成は停止中です。</strong> 理由: {topbar.paused.reason}
            </span>
            {onResume ? (
              <button type="button" className="btn btn--secondary btn--sm" onClick={onResume}>
                状況を確認しました — 生成を再開する(代表者)
              </button>
            ) : null}
          </div>
        ) : null}

        <main id="main" ref={mainRef} tabIndex={-1} className="page">
          {children}
        </main>
      </div>
    </div>
  );
}

/** ページ見出し */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="page-header">
      <div className="page-header__titles">
        <h1>{title}</h1>
        {subtitle ? <p className="page-header__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </div>
  );
}
