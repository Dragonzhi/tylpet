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
  | "renderer_unavailable";

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

export interface TimerStartPayload {
  durationMs: number;
  label?: string;
}

export interface TimerPausePayload {
  timerId: string;
}

export interface TimerCancelPayload {
  timerId: string;
}

export interface WaitPayload {
  durationMs: number;
}

// --- Action payload map ---
export interface ActionPayloadMap {
  "motion.play": MotionPlayPayload;
  "expression.set": ExpressionSetPayload;
  "look.set": LookSetPayload;
  "window.move": WindowMovePayload;
  "outfit.equip": OutfitEquipPayload;
  "speech.say": SpeechSayPayload;
  "timer.start": TimerStartPayload;
  "timer.pause": TimerPausePayload;
  "timer.cancel": TimerCancelPayload;
  "wait": WaitPayload;
}

export type ActionType = keyof ActionPayloadMap;

// --- Discriminated union of all action requests ---
export type ActionRequest = {
  [K in ActionType]: ActionEnvelope<K, ActionPayloadMap[K]>;
}[ActionType];
