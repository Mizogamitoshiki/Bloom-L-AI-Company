"use client";

import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import type { CompanyStateView, EmployeeStateView } from "@adapters/db/store";
import type { DisplayState } from "@core/domain";
import { PixelAvatar, OverworldSprite } from "./PixelAvatar";
import { StatusBadge } from "./StatusBadge";
import { IconClock, IconStamp } from "./icons";

/** 実状態から導く、真実だけを話す吹き出し文言(架空の進捗・数値は作らない) */
function stateBubbleText(employee: EmployeeStateView): string | null {
  switch (employee.display.state) {
    case "researching": return "調べもの中…";
    case "creating": return "制作中…";
    case "qa": return "品質チェック中";
    case "meeting": return "打ち合わせ中";
    case "awaiting_approval": return `承認おねがいします（${employee.display.awaitingApprovalCount}件）`;
    case "budget_paused": return "いまは一時停止中";
    case "error": return "エラーを確認中";
    default: return null; // idle/done/stale は状態吹き出しを出さない
  }
}

/** ラウンジで雑談する社員の、業務を主張しない中立な小話 */
const SMALL_TALK: readonly string[] = [
  "おつかれさまです", "少し休憩しましょう", "コーヒーどうぞ", "いい調子ですね",
  "泉州、今日はいい天気", "次の企画たのしみ", "ちょっと一息",
];

const WORKING_STATES = new Set(["researching", "creating", "meeting", "qa"]);

interface AgentPoint {
  x: number;
  y: number;
}

type OfficeMotion = "idle" | "working" | "meeting" | "approval" | "done" | "error" | "paused";

/**
 * 各社員の自席。座標は1021×763の参照画像に対する割合で、足元の位置を示す。
 * 右端17%は準備中部門のため、ライブ社員の移動範囲には含めない。
 */
const EMPLOYEE_HOME: Record<string, AgentPoint> = {
  emp_aoi: { x: 68.0, y: 18.5 },
  emp_ren: { x: 64.0, y: 39.0 },
  emp_rin: { x: 17.5, y: 39.0 },
  emp_sora: { x: 45.5, y: 52.0 },
  emp_kotoha: { x: 70.0, y: 62.5 },
  emp_tsumugi: { x: 18.0, y: 20.5 },
  emp_shion: { x: 42.0, y: 21.0 },
  emp_minato: { x: 25.0, y: 62.5 },
  emp_hinata: { x: 52.0, y: 84.5 },
};

const LOUNGE_POINTS: readonly AgentPoint[] = [
  { x: 35.5, y: 83.5 },
  { x: 43.0, y: 87.0 },
  { x: 51.0, y: 82.0 },
  { x: 58.0, y: 87.0 },
  { x: 47.0, y: 76.5 },
];

const MEETING_POINTS: readonly AgentPoint[] = [
  { x: 40.5, y: 66.5 },
  { x: 46.0, y: 70.0 },
  { x: 52.0, y: 70.0 },
  { x: 57.0, y: 65.5 },
];

const APPROVAL_POINTS: readonly AgentPoint[] = [
  { x: 60.0, y: 29.0 },
  { x: 66.0, y: 29.5 },
  { x: 72.0, y: 29.0 },
];

const QA_POINTS: readonly AgentPoint[] = [
  { x: 38.5, y: 28.5 },
  { x: 43.5, y: 29.0 },
  { x: 48.0, y: 28.5 },
];

function pointForIndex(points: readonly AgentPoint[], index: number): AgentPoint {
  return points[index % points.length] ?? points[0] ?? { x: 48, y: 50 };
}

function motionForState(state: DisplayState): OfficeMotion {
  switch (state) {
    case "researching":
    case "creating":
    case "qa":
      return "working";
    case "meeting":
      return "meeting";
    case "awaiting_approval":
      return "approval";
    case "done_today":
      return "done";
    case "error":
      return "error";
    case "budget_paused":
    case "stale":
      return "paused";
    default:
      return "idle";
  }
}

function destinationForState(employee: EmployeeStateView, index: number): AgentPoint {
  switch (employee.display.state) {
    case "idle":
    case "done_today":
    case "budget_paused":
      return pointForIndex(LOUNGE_POINTS, index);
    case "meeting":
      return pointForIndex(MEETING_POINTS, index);
    case "awaiting_approval":
      return pointForIndex(APPROVAL_POINTS, index);
    case "qa":
      return pointForIndex(QA_POINTS, index);
    default:
      return EMPLOYEE_HOME[employee.id] ?? { x: 48, y: 50 };
  }
}

function pathToDestination(home: AgentPoint, destination: AgentPoint): AgentPoint[] {
  const distance = Math.hypot(home.x - destination.x, home.y - destination.y);
  if (distance < 2) return [];

  const route: AgentPoint[] = [];
  if (home.y < 35) route.push({ x: home.x, y: 31.5 });
  if (home.x < 34 || home.x > 61 || home.y < 35) route.push({ x: 49.0, y: 44.5 });
  if (destination.y > 72) route.push({ x: 49.0, y: 60.0 }, { x: 49.0, y: 72.0 });
  if (destination.y < 35) route.push({ x: 52.0, y: 36.0 });
  route.push(destination);
  return route;
}

function patrolPoints(employee: EmployeeStateView, index: number, destination: AgentPoint): AgentPoint[] {
  if (employee.display.state === "idle" || employee.display.state === "done_today") {
    const next = pointForIndex(LOUNGE_POINTS, index + 2);
    return [destination, next];
  }
  if (employee.display.state === "awaiting_approval") {
    return [destination, { x: Math.min(74, destination.x + 1.4), y: destination.y + 1 }];
  }
  return [destination];
}

function employeeAriaLabel(employee: EmployeeStateView): string {
  return `${employee.name}、${employee.role}。現在: ${employee.display.reason}。クリックで詳細`;
}

function LiveEmployee({
  employee,
  index,
  selected,
  onSelect,
}: {
  employee: EmployeeStateView;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const home = EMPLOYEE_HOME[employee.id] ?? { x: 48, y: 50 };
  const [position, setPosition] = useState<AgentPoint>(home);
  const [moving, setMoving] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [travelMs, setTravelMs] = useState(900);
  const positionRef = useRef(position);
  const working = WORKING_STATES.has(employee.display.state);
  const [bubble, setBubble] = useState<string | null>(null);

  // 吹き出し(会話・状態)。実状態からの真実か、業務を主張しない中立な小話だけを表示する。
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const stateText = stateBubbleText(employee);
    const idle = employee.display.state === "idle" || employee.display.state === "done_today";
    if (!stateText && !idle) return; // stale等は吹き出しなし
    let turn = index;
    const show = (): void => {
      const text = idle ? (SMALL_TALK[turn % SMALL_TALK.length] ?? null) : stateText;
      turn += 1;
      if (text) {
        setBubble(text);
        timers.push(window.setTimeout(() => setBubble(null), 2800));
      }
      // 社員ごとに間隔をずらし、たまに会話が重なるように見せる
      timers.push(window.setTimeout(show, 5200 + (idle ? 3600 : 1600) + ((index * 970) % 3400)));
    };
    timers.push(window.setTimeout(show, 1800 + index * 900));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [employee.display.state, employee.id, index, employee.display.awaitingApprovalCount]);

  useEffect(() => {
    const timers: number[] = [];
    const destination = destinationForState(employee, index);
    const route = pathToDestination(positionRef.current, destination);
    const patrol = patrolPoints(employee, index, destination);
    let patrolIndex = 0;

    const schedule = (callback: () => void, delay: number): void => {
      timers.push(window.setTimeout(callback, delay));
    };

    const settleAt = (next: AgentPoint): void => {
      positionRef.current = next;
      setPosition(next);
      setMoving(false);
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settleAt(destination);
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }

    const moveTo = (next: AgentPoint, onArrive: () => void): void => {
      const current = positionRef.current;
      const distance = Math.hypot(next.x - current.x, next.y - current.y);
      if (distance < 0.3) {
        settleAt(next);
        schedule(onArrive, 160);
        return;
      }

      const duration = Math.max(720, Math.min(2300, Math.round(distance * 58)));
      setFacing(next.x < current.x ? "left" : "right");
      setTravelMs(duration);
      setMoving(true);
      positionRef.current = next;
      setPosition(next);
      schedule(() => {
        setMoving(false);
        onArrive();
      }, duration + 90);
    };

    const startPatrol = (): void => {
      if (patrol.length < 2) return;
      const dwell = 4200 + ((index * 430) % 1800);
      schedule(() => {
        patrolIndex = (patrolIndex + 1) % patrol.length;
        moveTo(patrol[patrolIndex] ?? destination, startPatrol);
      }, dwell);
    };

    const walkRoute = (routeIndex: number): void => {
      const next = route[routeIndex];
      if (!next) {
        settleAt(destination);
        startPatrol();
        return;
      }
      moveTo(next, () => walkRoute(routeIndex + 1));
    };

    schedule(() => walkRoute(0), 420 + index * 650);
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [employee.display.state, employee.id, index]);

  const style = {
    "--agent-x": `${position.x}%`,
    "--agent-y": `${position.y}%`,
    "--agent-travel": `${travelMs}ms`,
    zIndex: 6 + Math.round(position.y),
  } as CSSProperties;

  return (
    <button
      type="button"
      className="office-live-agent"
      style={style}
      data-working={working}
      data-moving={moving}
      data-facing={facing}
      data-motion={motionForState(employee.display.state)}
      data-motion-employee={employee.id}
      data-state={employee.display.state}
      data-selected={selected}
      data-employee={employee.id}
      onClick={() => onSelect(employee.id)}
      title={`${employee.name}（${employee.role}）`}
      aria-label={employeeAriaLabel(employee)}
    >
      <span className="office-live-agent__focus" aria-hidden="true" />
      {bubble ? (
        <span className="office-live-agent__bubble" data-kind={working || employee.display.state === "meeting" ? "state" : "talk"} aria-hidden="true">
          {bubble}
        </span>
      ) : null}
      <span className="office-live-agent__body" aria-hidden="true">
        <span className="office-live-agent__facing">
          <OverworldSprite seed={employee.id} hue={employee.spriteHue} />
        </span>
        <span className="office-live-agent__shadow" />
        <span className="office-live-agent__travel">•••</span>
      </span>
      <span className="office-live-agent__identity" aria-hidden="true">
        <strong>{employee.name}</strong>
        <StatusBadge
          state={employee.display.state}
          solid
          suffix={employee.display.state === "awaiting_approval" ? String(employee.display.awaitingApprovalCount) : undefined}
        />
      </span>
    </button>
  );
}

function MobileEmployeeCard({ employee, onSelect }: { employee: EmployeeStateView; onSelect: (id: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      className="office-mobile-employee"
      data-motion={motionForState(employee.display.state)}
      onClick={() => onSelect(employee.id)}
      aria-label={employeeAriaLabel(employee)}
    >
      <span className="office-mobile-employee__portrait" aria-hidden="true">
        <PixelAvatar hue={employee.spriteHue} seed={employee.id} />
      </span>
      <span className="office-mobile-employee__copy">
        <strong>{employee.name}</strong>
        <span>{employee.role}</span>
        <small>{employee.currentTaskTitle ?? employee.display.reason}</small>
      </span>
      <StatusBadge
        state={employee.display.state}
        solid
        suffix={employee.display.state === "awaiting_approval" ? String(employee.display.awaitingApprovalCount) : undefined}
      />
    </button>
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
  const planned = state.departments.filter((department) => department.status === "planned");
  const plannedDept = planned.find((department) => department.id === plannedOpen);
  const selectedEmployee = state.employees.find((employee) => employee.id === selectedId) ?? state.employees[0] ?? null;

  return (
    <div className="office office-v46">
      <div className="office-scene" id="main-office" aria-label="Bloom-L AI Company ライブオフィス">
        {/* 実データ駆動のクリーンなオフィス。部屋・家具はコード生成。名前・状態・件数はすべて実DBから。 */}
        <div className="office-floor" aria-hidden="true">
          <div className="office-floor__windows" />
          <div className="office-room office-room--studio"><span className="office-room__label">コンテンツスタジオ</span></div>
          <div className="office-room office-room--qa"><span className="office-room__label">品質管理ルーム</span></div>
          <div className="office-room office-room--ceo"><span className="office-room__label">CEOルーム</span></div>
          <div className="office-zone office-zone--meeting"><span className="office-zone__label">会議テーブル</span></div>
          <div className="office-zone office-zone--lounge"><span className="office-zone__label">ラウンジ</span></div>
          {/* 各社員の自席(足元座標に机を置く)。キャラはこの上に立つ */}
          {state.employees.map((employee) => {
            const home = EMPLOYEE_HOME[employee.id];
            if (!home) return null;
            return <span key={employee.id} className="office-desk" style={{ left: `${home.x}%`, top: `${home.y}%` }} />;
          })}
          <div className="office-floor__brand">Bloom-L</div>
        </div>

        <div className="office-live-agent-layer" role="group" aria-label="状態に連動して移動するAI社員">
          {state.employees.map((employee, index) => (
            <LiveEmployee
              key={employee.id}
              employee={employee}
              index={index}
              selected={employee.id === selectedEmployee?.id}
              onSelect={onSelect}
            />
          ))}
        </div>

        <div className="office-depts" aria-label="準備中の部門">
          {planned.map((department) => (
            <button
              key={department.id}
              type="button"
              className="office-dept"
              onClick={() => setPlannedOpen(department.id)}
              aria-label={`${department.name}（準備中）の説明を開く`}
            >
              <span className="office-dept__name">{department.name}</span>
              <span className="office-dept__badge">準備中</span>
            </button>
          ))}
        </div>

        <a
          className="office-approval-launcher"
          href="/approvals"
          data-has-items={state.counts.awaitingApproval > 0}
          aria-label={`承認画面を開く（承認待ち ${state.counts.awaitingApproval}件）`}
        >
          <IconStamp size={14} />
          <span>承認</span>
          <strong>{state.counts.awaitingApproval}</strong>
        </a>

        {selectedEmployee ? (
          <aside className="office-employee-card" aria-label={`${selectedEmployee.name}の選択情報`}>
            <div className="office-employee-card__topline">
              <span className="office-employee-card__avatar" aria-hidden="true">
                <PixelAvatar hue={selectedEmployee.spriteHue} seed={selectedEmployee.id} />
              </span>
              <span className="office-employee-card__head">
                <span className="office-employee-card__eyebrow">AI TEAM MEMBER</span>
                <strong>{selectedEmployee.name}</strong>
                <span>{selectedEmployee.role}</span>
              </span>
              <StatusBadge
                state={selectedEmployee.display.state}
                solid
                suffix={selectedEmployee.display.state === "awaiting_approval" ? String(selectedEmployee.display.awaitingApprovalCount) : undefined}
              />
            </div>
            <dl>
              <dt>現在の仕事</dt>
              <dd>{selectedEmployee.currentTaskTitle ?? selectedEmployee.display.reason}</dd>
              <dt>現在の段階</dt>
              <dd>{selectedEmployee.display.stage ?? "実行イベント待ち"}</dd>
              <dt>モデル</dt>
              <dd>{selectedEmployee.modelProfile}</dd>
            </dl>
            <button type="button" className="office-employee-card__action" onClick={() => onOpenDetail(selectedEmployee.id)}>
              <IconClock size={15} />
              仕事の詳細を見る
            </button>
          </aside>
        ) : null}
      </div>

      <div className="office-mobile-roster" aria-label="AI社員の状態カード">
        <div className="office-mobile-roster__heading">
          <span>AIマーケティング部</span>
          <strong>{state.counts.running}名 稼働中</strong>
        </div>
        {state.employees.map((employee) => (
          <MobileEmployeeCard key={employee.id} employee={employee} onSelect={onSelect} />
        ))}
      </div>

      {plannedDept ? (
        <>
          <div className="drawer-backdrop" onClick={() => setPlannedOpen(null)} aria-hidden="true" />
          <div className="dialog" role="dialog" aria-modal="true" aria-label={`${plannedDept.name}の説明`}>
            <h2 style={{ marginTop: 0, fontSize: 17 }}>{plannedDept.name}</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>現在は準備中です。</p>
            <p style={{ fontSize: 13 }}>{plannedDept.unlockNote ?? "将来の部門です。"}</p>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              この部門はまだ実装されていません。稼働状態・タスクは存在しません。
            </p>
            <button type="button" className="btn btn--secondary" onClick={() => setPlannedOpen(null)}>
              閉じる
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
