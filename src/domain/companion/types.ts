import type { BehaviorMode, CompanionIdleFrequency } from "../settings/types";

export type CompanionPetState = "idle" | "blink" | "listen" | "speak" | "sleep" | "drag";

export type CompanionCue =
  | "idle.stretch"
  | "idle.greet"
  | "idle.courtesy"
  | "task.complete"
  | "task.failed";

export interface CompanionActionRecord {
  motion: string;
  startedAtMs: number;
}

export interface CompanionSnapshot {
  nowMs: number;
  mode: BehaviorMode;
  petState: CompanionPetState;
  lastUserInteractionAtMs: number;
  nextCandidateAtMs: number;
  actionHistory: readonly CompanionActionRecord[];
  availableMotions: readonly string[];
  bodyMotionBusy: boolean;
  reducedMotion: boolean;
  autonomyEnabled: boolean;
  idleFrequency: CompanionIdleFrequency;
}

export type CompanionDecision =
  | {
    kind: "wait";
    nextCheckAtMs: number;
    reason: "protection" | "not-due" | "busy" | "motion-cooldown" | "hourly-budget";
  }
  | {
    kind: "skip";
    reason: "disabled" | "mode-blocked" | "no-motion";
  }
  | {
    kind: "act";
    cue: CompanionCue;
    motion: string;
    speed: number;
    cooldownKey: string;
  };

export type ChatAttentionState = "idle" | "listening" | "generating";

export interface ChatAttentionEvent {
  state: ChatAttentionState;
}

export const CHAT_ATTENTION_EVENT = "chat-attention-state-changed";

export function parseChatAttentionEvent(input: unknown): ChatAttentionEvent | null {
  if (!input || typeof input !== "object") return null;
  const state = (input as Record<string, unknown>).state;
  return state === "idle" || state === "listening" || state === "generating"
    ? { state }
    : null;
}
