"use client";
import { useEffect, type JSX, type ReactNode } from "react";
import { IconAlert, IconCoffee, IconChevronRight } from "./icons";

/** カード枠 */
export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`card${className ? " " + className : ""}`}>
      {title ? (
        <div className="card__header">
          <h2 className="card__title">{title}</h2>
          {action ? <span style={{ marginLeft: "auto" }}>{action}</span> : null}
        </div>
      ) : null}
      <div className="card__body">{children}</div>
    </section>
  );
}

/** KPIカード。value=null は「未取得」を明示(0と混同しない) */
export function KpiCard({
  label,
  value,
  note,
  icon,
  tone = "primary",
  href,
}: {
  label: string;
  value: number | null;
  note?: string;
  icon: ReactNode;
  tone?: "primary" | "warning" | "success" | "muted";
  href?: string;
}): JSX.Element {
  const inner = (
    <>
      <span className="kpi-card__icon" data-tone={tone} aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="kpi-card__label">{label}</span>
        <br />
        {value === null ? (
          <span className="kpi-card__value--unavailable">未取得</span>
        ) : (
          <span className="kpi-card__value">{value.toLocaleString()}</span>
        )}
        {note ? <span className="kpi-card__note" style={{ display: "block" }}>{note}</span> : null}
      </span>
    </>
  );
  if (href) {
    return (
      <a className="kpi-card" href={href} style={{ textDecoration: "none", color: "inherit" }}>
        {inner}
      </a>
    );
  }
  return <div className="kpi-card">{inner}</div>;
}

export function EmptyState({ title, message, icon }: { title: string; message?: string; icon?: ReactNode }): JSX.Element {
  return (
    <div className="state-block" role="status">
      <span className="state-block__icon" aria-hidden="true">
        {icon ?? <IconCoffee size={32} />}
      </span>
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
    </div>
  );
}

export function ErrorState({ title, message, action }: { title: string; message?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="error-state" role="alert">
      <div className="state-block">
        <span className="state-block__icon" aria-hidden="true">
          <IconAlert size={32} />
        </span>
        <h2>{title}</h2>
        {message ? <p>{message}</p> : null}
        {action}
      </div>
    </div>
  );
}

export function LoadingState({ label = "読み込み中…" }: { label?: string }): JSX.Element {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <p>{label}</p>
    </div>
  );
}

/** 右方向リンク(「すべて見る」など) */
export function FooterLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <a className="card__footer-link" href={href}>
      {children}
      <IconChevronRight size={13} />
    </a>
  );
}

/** 右ドロワー。Escで閉じる・背景クリックで閉じる */
export function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </>
  );
}
