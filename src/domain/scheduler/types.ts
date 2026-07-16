import type { ActionRequest, ActionResult, ActionSource, ActionType } from "../actions/types";

// --- Priority (from plan 4.3: 安全停止 > 用户直接操作 > 设置/菜单命令 > 计时提醒 > Agent 主动行为 > idle) ---
export type Priority = "safety-stop" | "user" | "menu" | "timer" | "agent" | "idle";

// --- Scheduling channels (from plan 4.3) ---
export type Channel =
  | "locomotion"
  | "body-motion"
  | "gaze-expression"
  | "speech"
  | "outfit"
  | "timer";

// --- Mutex groups: body-motion and outfit share a group; others are independent ---
export type MutexGroup = "body" | "locomotion" | "gaze" | "speech" | "timer";

// --- Executor interface: schedulers call this to run actions ---
export interface ActionExecutor {
  execute(action: ActionRequest, signal: AbortSignal): Promise<ActionResult>;
}

// --- Submit options ---
export interface SubmitOptions {
  channel: Channel;
  priority?: Priority;        // defaults to getDefaultPriority(action.source)
  cooldownMs?: number;        // if set, same actionType can't be resubmitted for this long after completion
}

// --- Scheduler event types ---
export type SchedulerEventType =
  | "submitted"
  | "started"
  | "completed"
  | "interrupted"
  | "rejected"
  | "timed_out"
  | "failed"
  | "cancelled"
  | "cooldown_rejected";

// --- Scheduler event (for tracing) ---
export interface SchedulerEvent {
  type: SchedulerEventType;
  actionId: string;
  actionType: ActionType;
  source: ActionSource;
  channel: Channel;
  priority: Priority;
  timestamp: number;
  reason?: string;
  errorCode?: string;
}

// --- Active (running) action ---
export interface ActiveAction {
  actionId: string;
  action: ActionRequest;
  channel: Channel;
  priority: Priority;
  startedAt: number;
}

// --- Pending (queued) action ---
export interface PendingAction {
  actionId: string;
  action: ActionRequest;
  channel: Channel;
  priority: Priority;
  submittedAt: number;
  cooldownMs?: number;
}

// --- Scheduler constructor options ---
export interface SchedulerOptions {
  clock?: () => number;        // defaults to () => Date.now()
  generateId?: () => string;   // defaults to counter-based generator
  executor?: ActionExecutor;   // required for non-wait actions to run
}

// --- Internal active action tracking (extends ActiveAction with runtime state) ---
export interface InternalActiveAction {
  actionId: string;
  action: ActionRequest;
  channel: Channel;
  priority: Priority;
  startedAt: number;
  abortController: AbortController;
  cancelReason: "interrupted" | "cancelled" | "timed_out";
  timeoutTimer?: ReturnType<typeof setTimeout>;
}
