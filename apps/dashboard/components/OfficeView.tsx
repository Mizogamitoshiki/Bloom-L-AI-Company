"use client";
import { useState, type JSX } from "react";
import type { CompanyStateView, EmployeeStateView } from "@adapters/db/store";
import { DISPLAY_ROOM } from "@core/domain";
import { PixelAvatar } from "./PixelAvatar";
import { StatusBadge } from "./StatusBadge";

const WORKING_STATES = new Set(["researching", "creating", "meeting", "qa"]);

function EmployeeButton({ emp, onSelect }: { emp: EmployeeStateView; onSelect: (id: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      className="emp"
      data-working={WORKING_STATES.has(emp.display.state)}
      onClick={() => onSelect(emp.id)}
      aria-label={`${emp.name}(${emp.role})の詳細を開く。現在: ${emp.display.reason}`}
    >
      <PixelAvatar hue={emp.spriteHue} />
      <span className="emp-name">{emp.name}</span>
      <span className="emp-role">{emp.role}</span>
      <StatusBadge
        state={emp.display.state}
        suffix={emp.display.state === "awaiting_approval" ? `(${emp.display.awaitingApprovalCount}件)` : undefined}
      />
    </button>
  );
}

function Room({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={`room ${className}`} aria-label={label}>
      <span className="room-label">{label}</span>
      <div className="room-members">{children}</div>
    </section>
  );
}

export function OfficeView({
  state,
  onSelect,
}: {
  state: CompanyStateView;
  onSelect: (id: string) => void;
}): JSX.Element {
  const [plannedOpen, setPlannedOpen] = useState<string | null>(null);
  const byRoom = (room: string) => state.employees.filter((e) => DISPLAY_ROOM[e.display.state] === room);
  const planned = state.departments.filter((d) => d.status === "planned");
  const plannedDept = planned.find((d) => d.id === plannedOpen);

  return (
    <div className="office" id="main">
      <Room className="room-desks" label="執務室">
        {byRoom("desk").map((e) => (
          <EmployeeButton key={e.id} emp={e} onSelect={onSelect} />
        ))}
      </Room>
      <Room className="room-meeting" label="会議室">
        {byRoom("meeting").map((e) => (
          <EmployeeButton key={e.id} emp={e} onSelect={onSelect} />
        ))}
      </Room>
      <Room className="room-qa" label="品質管理室">
        {byRoom("qa_room").map((e) => (
          <EmployeeButton key={e.id} emp={e} onSelect={onSelect} />
        ))}
      </Room>
      <Room className="room-ceo" label="社長室">
        <div className="ceo-avatar">
          <PixelAvatar hue={0} ceo />
          <span className="emp-name">代表</span>
          <span className="emp-role">Bloom-L</span>
        </div>
        {byRoom("ceo_office").map((e) => (
          <EmployeeButton key={e.id} emp={e} onSelect={onSelect} />
        ))}
        <div className="approval-box" role="status">
          承認ボックス: {state.counts.awaitingApproval}件
        </div>
      </Room>
      <Room className="room-lounge" label="休憩スペース">
        {byRoom("lounge").map((e) => (
          <EmployeeButton key={e.id} emp={e} onSelect={onSelect} />
        ))}
      </Room>
      <div className="room-planned-row">
        {planned.map((d) => (
          <button
            key={d.id}
            type="button"
            className="room room-planned"
            onClick={() => setPlannedOpen(d.id)}
            aria-label={`${d.name}(準備中)の説明を開く`}
          >
            <span className="room-label">{d.name}</span>
            <span style={{ fontSize: 12, fontWeight: 700 }}>準備中</span>
          </button>
        ))}
      </div>
      {plannedDept ? (
        <>
          <div className="drawer-backdrop" onClick={() => setPlannedOpen(null)} aria-hidden="true" />
          <div className="dialog" role="dialog" aria-modal="true" aria-label={`${plannedDept.name}の説明`}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>{plannedDept.name}(準備中)</h2>
            <p style={{ fontSize: 13 }}>{plannedDept.unlockNote ?? "将来の部門です。"}</p>
            <p style={{ fontSize: 12, color: "var(--color-ink-muted)" }}>
              この部門はまだ実装されていません。稼働状態・タスクは存在しません。
            </p>
            <button type="button" className="btn-secondary" onClick={() => setPlannedOpen(null)}>
              閉じる
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
