// --- Protocol version ---
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// --- Action source ---
export type ActionSource = "user" | "agent" | "timer" | "system" | "dev";

// --- Action envelope (the typed request after validation) ---
export interface ActionEnvelope<TType extends string, TPayload> {
  id: string;
  type: TType;
  payload: TPayload;
  source: ActionSource;
  requestedAt: number;
  timeoutMs?: number;
  correlationId?: string;
}

// --- Action status and result ---
export type ActionStatus =
  | "completed"
  | "interrupted"
  | "rejected"
  | "timed_out"
  | "failed";

export interface ActionResult {
  actionId: string;
  status: ActionStatus;
  startedAt?: number;
  finishedAt: number;
  reason?: string;
  errorCode?: string;
}

// --- Error codes ---
export type ActionErrorCode =
  | "unsupported_action"
  | "invalid_payload"
  | "user_override"
  | "cooldown_active"
  | "permission_denied"
  | "renderer_unavailable"
  | "timer_conflict"
  | "timer_not_found"
  | "timer_invalid_state"
  | "timer_native_error"
  | "speech_disabled"
  | "speech_unavailable"
  | "speech_cancelled"
  | "speech_failed";

// --- Window target (used by window.move payload) ---
export type WindowSemanticPosition =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type WindowTarget =
  | { kind: "semantic"; position: WindowSemanticPosition }
  | { kind: "normalized"; x: number; y: number };

// --- Per-action payload types ---
export interface MotionPlayPayload {
  motion: string;
  speed?: number;
}

export interface ExpressionSetPayload {
  expression: string;
  durationMs?: number;
}

export interface LookSetPayload {
  x: number;
  y: number;
}

export interface WindowMovePayload {
  target: WindowTarget;
  durationMs?: number;
}

export interface OutfitEquipPayload {
  outfitId: string;
}

export interface SpeechSayPayload {
  text: string;
  interrupt?: boolean;
}

/** 模型只能提出候选；实际持久化由聊天窗口按用户策略确认后完成。 */
export interface MemoryProposePayload {
  category: "preference" | "profile" | "note";
  content: string;
  reason: string;
}

export interface TimerStartPayload {
  durationMs: number;
  label?: string;
  kind?: "focus" | "break" | "custom";
}

export interface TimerPausePayload {
  timerId: string;
}

export interface TimerResumePayload {
  timerId: string;
}

export interface TimerCancelPayload {
  timerId: string;
}

export interface WaitPayload {
  durationMs: number;
}

/** 系统媒体播放状态驱动的持续视觉反应；不包含任何媒体元数据。 */
export interface MediaReactPayload {
  state: "playing" | "paused" | "stopped";
}

// --- Action payload map ---
export interface ActionPayloadMap {
  "motion.play": MotionPlayPayload;
  "expression.set": ExpressionSetPayload;
  "look.set": LookSetPayload;
  "window.move": WindowMovePayload;
  "outfit.equip": OutfitEquipPayload;
  "speech.say": SpeechSayPayload;
  "memory.propose": MemoryProposePayload;
  "timer.start": TimerStartPayload;
  "timer.pause": TimerPausePayload;
  "timer.resume": TimerResumePayload;
  "timer.cancel": TimerCancelPayload;
  "media.react": MediaReactPayload;
  "wait": WaitPayload;
}

export type ActionType = keyof ActionPayloadMap;

// --- Discriminated union of all action requests ---
export type ActionRequest = {
  [K in ActionType]: ActionEnvelope<K, ActionPayloadMap[K]>;
}[ActionType];
