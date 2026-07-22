import type { ActionRequest, ActionResult, ActionType } from "../actions/types";
import type { ProviderToolCall } from "../chat/types";

export const AGENT_TOOL_PROTOCOL_VERSION = 1 as const;

export type AgentToolName =
  | "pet_play_motion"
  | "pet_set_expression"
  | "pet_set_look"
  | "pet_move_window"
  | "timer_start"
  | "timer_pause"
  | "timer_resume"
  | "timer_cancel";

export interface AgentDispatchRequest {
  requestId: string;
  action: unknown;
  confirmed: boolean;
}

export interface AgentDispatchResponse {
  requestId: string;
  result: ActionResult;
}

export interface AgentToolExecution {
  toolCall: ProviderToolCall;
  action?: ActionRequest;
  result: ActionResult;
}

export interface AgentPolicyDecision {
  allowed: boolean;
  errorCode?: "permission_denied" | "confirmation_required" | "rate_limit_exceeded" | "cooldown_active";
  reason?: string;
}

export interface AgentPolicyOptions {
  enabled: boolean;
  confirmed: boolean;
}

export interface AgentLimits {
  maxModelCalls: number;
  maxToolSteps: number;
  maxToolCallsPerStep: number;
  maxOutputChars: number;
  maxTurnMs: number;
  maxConfirmationWaitMs: number;
  maxActionsPerMinute: number;
  cooldownMs: Partial<Record<ActionType, number>>;
}
