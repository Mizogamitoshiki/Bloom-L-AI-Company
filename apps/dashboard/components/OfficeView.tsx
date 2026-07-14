"use client";
import { useState, type JSX } from "react";
import type { CompanyStateView, EmployeeStateView } from "@adapters/db/store";
import { PixelAvatar } from "./PixelAvatar";
import { StatusBadge } from "./StatusBadge";
import { IconPen, IconShield, IconBuilding, IconUsers, IconCoffee, IconStamp, IconClock } from "./icons";

const WORKING_STATES = new Set(["researching", "creating", "meeting", "qa"]);

type OfficeRoom = "studio" | "qa" | "ceo" | "desks" | "meeting" | "lounge";

/**
 * 社員の定位置。状態で全員が同じ部屋へ移動するとオフィスが空洞化するため、
 * 役割ごとのホームポジションを持ち、会議中だけ会議スペースへ移動させる。
 * 稼働状態そのものは StatusBadge でDBの事実をそのまま表示する。
 */
const EMPLOYEE_HOME_ROOM: Record<string, OfficeRoom> = {
  emp_aoi: "ceo",
  emp_sora: "studio",
  emp_kotoha: "studio",
  emp_tsumugi: "studio",
  emp_shion: "qa",
  emp_ren: "desks",
  emp_rin: "desks",
  emp_minato: "desks",
  emp_hinata: "lounge",
};

function employeeRoom(employee: EmployeeStateView): OfficeRoom {
  if (employee.display.state === "meeting") return "meeting";
  return EMPLOYEE_HOME_ROOM[employee.id] ?? "desks";
}

/** 一覧表示用の短縮役職(正式名称は詳細パネル・title属性で表示) */
const ROLE_SHORT: Record<string, string> = {
  AI社長補佐: "社長補佐",
  集客戦略責任者: "戦略",
  リサーチ担当: "リサーチ",
  コンテンツ企画担当: "企画",
  コピーライター: "コピー",
  デザイナー: "デザイン",
  品質管理担当: "品質管理",
  データ分析担当: "分析",
  顧客対応担当: "顧客対応",
};

function EmployeeButton({
  emp,
  variant,
  selected,
  onSelect,
}: {
  emp: EmployeeStateView;
  variant: "desk" | "meeting" | "lounge";
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const working = WORKING_STATES.has(emp.display.state);
  return (
    <button
      type="button"
      className={`emp emp--${variant}`}
      data-working={working}
      data-state={emp.display.state}
      data-selected={selected}
      data-employee={emp.id}
      onClick={() => onSelect(emp.id)}
      title={`${emp.name}(${emp.role})`}
      aria-label={`${emp.name}、${emp.role}。現在: ${emp.display.reason}。クリックで詳細`}
    >
      <span className="emp-desk" aria-hidden="true">
        <PixelAvatar hue={emp.spriteHue} seed={emp.id} />
        {working ? <span className="typing-dots" /> : null}
      </span>
      <span className="emp-name">{emp.name}</span>
      <span className="emp-role">{ROLE_SHORT[emp.role] ?? emp.role}</span>
      <StatusBadge
        state={emp.display.state}
        solid
        suffix={emp.display.state === "awaiting_approval" ? String(emp.display.awaitingApprovalCount) : undefined}
      />
    </button>
  );
}

function RoomDecor({ area }: { area: string }): JSX.Element {
  return (
    <div className={`room-decor room-decor--${area}`} aria-hidden="true">
      {area === "studio" ? (
        <>
          <span className="pixel-camera pixel-camera--left" />
          <span className="pixel-monitor pixel-monitor--wide" />
          <span className="pixel-light" />
        </>
      ) : null}
      {area === "qa" ? (
        <>
          <span className="pixel-monitor pixel-monitor--dual" />
          <span className="pixel-shelf" />
        </>
      ) : null}
      {area === "ceo" ? (
        <>
          <span className="pixel-books" />
          <span className="pixel-plant" />
        </>
      ) : null}
      {area === "desks" ? (
        <>
          <span className="pixel-printer" />
          <span className="pixel-plant pixel-plant--floor" />
        </>
      ) : null}
      {area === "meeting" ? (
        <>
          <span className="pixel-board" />
          <span className="meeting-table" />
        </>
      ) : null}
      {area === "lounge" ? (
        <>
          <span className="pixel-sofa" />
          <span className="pixel-coffee-table" />
          <span className="pixel-water" />
        </>
      ) : null}
    </div>
  );
}

function Room({
  area,
  label,
  Icon,
  children,
  className,
}: {
  area: string;
  label: string;
  Icon: (p: { size?: number }) => JSX.Element;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={`room room--${area}${className ? " " + className : ""}`} aria-label={label}>
      <span className="room__label">
        <Icon size={13} />
        {label}
      </span>
      <RoomDecor area={area} />
      <div className="room__members">{children}</div>
    </section>
  );
}

export function OfficeView({
  state,
  selectedId,
  onSelect,
  onOpenDetail,
}: {
  state: CompanyStateView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenDetail: (id: string) => void;
}): JSX.Element {
  const [plannedOpen, setPlannedOpen] = useState<string | null>(null);
  const inRoom = (room: OfficeRoom) => state.employees.filter((employee) => employeeRoom(employee) === room);
  const planned = state.departments.filter((d) => d.status === "planned");
  const plannedDept = planned.find((d) => d.id === plannedOpen);
  const selectedEmployee = state.employees.find((employee) => employee.id === selectedId) ?? null;
  const btn = (variant: "desk" | "meeting" | "lounge") => (e: EmployeeStateView) => (
    <EmployeeButton key={e.id} emp={e} variant={variant} selected={e.id === selectedId} onSelect={onSelect} />
  );

  return (
    <div className="office">
      <div className="office__windows" aria-hidden="true" />
      <div className="office__brand-sign" aria-hidden="true">Bloom-L</div>
      <div className="office__walk-path office__walk-path--one" aria-hidden="true" />
      <div className="office__walk-path office__walk-path--two" aria-hidden="true" />
      <div className="office__grid" id="main-office">
        <Room area="studio" label="コンテンツスタジオ" Icon={IconPen}>
          {inRoom("studio").map(btn("desk"))}
          <span className="plant" aria-hidden="true" />
        </Room>

        <Room area="qa" label="品質管理ルーム" Icon={IconShield}>
          {inRoom("qa").map(btn("desk"))}
        </Room>

        <Room area="ceo" label="社長室" Icon={IconBuilding}>
          <div className="ceo-avatar">
            <PixelAvatar hue={0} ceo seed="bloom-owner" />
            <span className="emp-name">代表</span>
            <span className="emp-role">Bloom-L</span>
          </div>
          {inRoom("ceo").map(btn("desk"))}
          <a
            className="approval-box-cta"
            href="/approvals"
            data-has-items={state.counts.awaitingApproval > 0}
            aria-label={`承認ボックスを開く(承認待ち ${state.counts.awaitingApproval}件)`}
          >
            <IconStamp size={16} />
            承認ボックス <strong>{state.counts.awaitingApproval}</strong>
            <span className="approval-box-hint">クリックで承認画面へ</span>
          </a>
        </Room>

        <Room area="desks" label="オープンワークスペース" Icon={IconUsers}>
          {inRoom("desks").map(btn("desk"))}
          {inRoom("desks").length === 0 ? <span className="emp-role">現在この部屋に社員はいません</span> : null}
          <span className="plant" aria-hidden="true" />
        </Room>

        <Room area="meeting" label="ミーティングテーブル" Icon={IconUsers}>
          {inRoom("meeting").map(btn("meeting"))}
          {inRoom("meeting").length === 0 ? <span className="room-empty-note">現在、会議はありません</span> : null}
        </Room>

        <Room area="lounge" label="ラウンジ" Icon={IconCoffee}>
          {inRoom("lounge").map(btn("lounge"))}
          {inRoom("lounge").length === 0 ? <span className="room-empty-note">待機中の社員はいません</span> : null}
        </Room>

        <div className="planned-col" aria-label="準備中の部門">
          {planned.map((d) => (
            <button key={d.id} type="button" className="room--planned" onClick={() => setPlannedOpen(d.id)} aria-label={`${d.name}(準備中)の説明を開く`}>
              <span className="planned-name">{d.name}</span>
              <span className="planned-tag">準備中</span>
            </button>
          ))}
        </div>
      </div>

      {selectedEmployee ? (
        <aside className="office-employee-card" aria-label={`${selectedEmployee.name}の選択情報`}>
          <div className="office-employee-card__avatar" aria-hidden="true">
            <PixelAvatar hue={selectedEmployee.spriteHue} seed={selectedEmployee.id} />
          </div>
          <div className="office-employee-card__head">
            <span className="office-employee-card__eyebrow">SELECTED MEMBER</span>
            <strong>{selectedEmployee.name}</strong>
            <span>{selectedEmployee.role}</span>
          </div>
          <StatusBadge state={selectedEmployee.display.state} solid />
          <dl>
            <dt>現在の仕事</dt>
            <dd>{selectedEmployee.currentTaskTitle ?? selectedEmployee.display.reason}</dd>
            <dt>使用モデル</dt>
            <dd>{selectedEmployee.modelProfile}</dd>
          </dl>
          <button type="button" className="office-employee-card__action" onClick={() => onOpenDetail(selectedEmployee.id)}>
            <IconClock size={15} />
            仕事の詳細を見る
          </button>
        </aside>
      ) : null}

      {plannedDept ? (
        <>
          <div className="drawer-backdrop" onClick={() => setPlannedOpen(null)} aria-hidden="true" />
          <div className="dialog" role="dialog" aria-modal="true" aria-label={`${plannedDept.name}の説明`}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>{plannedDept.name}</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>現在は準備中です。</p>
            <p style={{ fontSize: 13 }}>{plannedDept.unlockNote ?? "将来の部門です。"}</p>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>この部門はまだ実装されていません。稼働状態・タスクは存在しません。</p>
            <button type="button" className="btn btn--secondary" onClick={() => setPlannedOpen(null)}>
              閉じる
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
