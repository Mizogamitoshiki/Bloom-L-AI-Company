/**
 * 状態導出リデューサ(docs/08 §3, docs/10 §2)。
 * 演出状態は必ずここで実イベント・実タスクから導出する。DBに演出状態を保存しない。
 * 信頼性絶対条件(§13): runningの実イベントが無い社員を「作業中」系にしない。
 * heartbeatが一定時間途絶えたrunningタスクは stale(状態不明)に落とす。
 */
import {
  type DisplayState,
  type TaskRow,
  type TaskEventRow,
  TYPE_TO_DISPLAY,
} from "./domain";

export interface EmployeeDisplay {
  state: DisplayState;
  /** 表示根拠(理由を隠さない: エラー内容・待機理由・最終更新) */
  reason: string;
  currentTaskId: string | null;
  /** 実イベントに記録がある段階名のみ。進捗率は存在しない(§13) */
  stage: string | null;
  lastEventAt: string | null;
  awaitingApprovalCount: number;
}

export interface DeriveInput {
  /** 当該社員のタスク(全期間。呼び出し側で社員別に絞る) */
  tasks: TaskRow[];
  /** 当該社員のタスクのイベント(taskId → 昇順イベント列) */
  eventsByTask: Map<string, TaskEventRow[]>;
  /** 当該社員が担当した成果物が承認待ちの投稿数 */
  awaitingApprovalCount: number;
  today: string;
  now: Date;
  staleMinutes: number;
}

function lastEvent(events: TaskEventRow[] | undefined): TaskEventRow | null {
  if (!events || events.length === 0) return null;
  return events[events.length - 1] ?? null;
}

function lastStage(events: TaskEventRow[] | undefined): string | null {
  if (!events) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev?.payloadJson) continue;
    try {
      const p = JSON.parse(ev.payloadJson) as { stage?: string };
      if (typeof p.stage === "string" && p.stage.length > 0) return p.stage;
    } catch {
      // payloadは書き込み時に検証済み。壊れていても表示は落とさない
    }
  }
  return null;
}

function minutesBetween(a: Date, isoB: string): number {
  return (a.getTime() - new Date(isoB).getTime()) / 60_000;
}

export function deriveEmployeeDisplay(input: DeriveInput): EmployeeDisplay {
  const { tasks, eventsByTask, awaitingApprovalCount, today, now, staleMinutes } = input;

  // 1) running タスク: startedイベントが実在するものだけを「作業中」候補にする
  const running = tasks.filter((t) => t.status === "running");
  for (const t of running) {
    const events = eventsByTask.get(t.id);
    const hasStarted = (events ?? []).some((e) => e.type === "started");
    const last = lastEvent(events);
    if (!hasStarted || !last) {
      // DB上runningでも実イベントが無い → 「作業中」と表示してはならない
      return {
        state: "stale",
        reason: "実行イベントが記録されていません(状態不明)",
        currentTaskId: t.id,
        stage: null,
        lastEventAt: last?.ts ?? null,
        awaitingApprovalCount,
      };
    }
    const silentMin = minutesBetween(now, last.ts);
    if (silentMin > staleMinutes) {
      return {
        state: "stale",
        reason: `最終更新から${Math.floor(silentMin)}分経過(停止の可能性)`,
        currentTaskId: t.id,
        stage: lastStage(events),
        lastEventAt: last.ts,
        awaitingApprovalCount,
      };
    }
    return {
      state: TYPE_TO_DISPLAY[t.type],
      reason: `タスク実行中: ${t.title}`,
      currentTaskId: t.id,
      stage: lastStage(events),
      lastEventAt: last.ts,
      awaitingApprovalCount,
    };
  }

  // 2) 予算停止
  const paused = tasks.find((t) => t.status === "budget_paused");
  if (paused) {
    return {
      state: "budget_paused",
      reason: "利用量しきい値超過。代表者の再開操作待ち",
      currentTaskId: paused.id,
      stage: null,
      lastEventAt: lastEvent(eventsByTask.get(paused.id))?.ts ?? null,
      awaitingApprovalCount,
    };
  }

  // 3) 本日の失敗(未回収)
  const failedToday = tasks.find((t) => t.status === "failed" && t.runDate === today);
  if (failedToday) {
    return {
      state: "error",
      reason: `失敗: ${failedToday.error ?? "理由未記録"}`,
      currentTaskId: failedToday.id,
      stage: null,
      lastEventAt: lastEvent(eventsByTask.get(failedToday.id))?.ts ?? null,
      awaitingApprovalCount,
    };
  }

  // 4) 担当成果物が承認待ち
  if (awaitingApprovalCount > 0) {
    return {
      state: "awaiting_approval",
      reason: `承認待ちの成果物が${awaitingApprovalCount}件あります`,
      currentTaskId: null,
      stage: null,
      lastEventAt: null,
      awaitingApprovalCount,
    };
  }

  // 5) 本日完了
  const doneToday = tasks.find((t) => t.status === "done" && t.runDate === today);
  if (doneToday) {
    return {
      state: "done_today",
      reason: "本日のタスクを完了",
      currentTaskId: null,
      stage: null,
      lastEventAt: lastEvent(eventsByTask.get(doneToday.id))?.ts ?? null,
      awaitingApprovalCount,
    };
  }

  // 6) 待機(queued含む: 実行はまだ始まっていないので「作業中」にしない)
  const queued = tasks.find((t) => t.status === "queued" || t.status === "pending");
  return {
    state: "idle",
    reason: queued ? `待機(次のタスク: ${queued.title})` : "本日のタスクなし",
    currentTaskId: null,
    stage: null,
    lastEventAt: null,
    awaitingApprovalCount,
  };
}

/** タスク状態遷移ガード(docs/06 §2)。不正遷移は例外 */
import { TASK_TRANSITIONS, type TaskStatus, POST_TRANSITIONS, type PostStatus } from "./domain";

export class InvalidTransitionError extends Error {
  constructor(kind: "task" | "post", from: string, to: string) {
    super(`${kind}の不正な状態遷移: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!TASK_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError("task", from, to);
}

export function assertPostTransition(from: PostStatus, to: PostStatus): void {
  if (!POST_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError("post", from, to);
}
