import type { ActionRequest } from "../actions/types";

export const OBSERVATION_PROTOCOL_VERSION = 1 as const;

export type ObservationEventType = "media.playback" | "dev-agent.status";
export type ObservationSensitivity = "status" | "metadata" | "content";

export interface ObservationSource {
  kind: "system" | "plugin";
  id: string;
}

export interface MediaPlaybackPayload {
  state: "playing" | "paused" | "stopped";
}

export interface DevAgentStatusPayload {
  state:
    | "session_started"
    | "working"
    | "waiting_for_user"
    | "completed"
    | "failed"
    | "stopped";
}

export interface ObservationPayloadMap {
  "media.playback": MediaPlaybackPayload;
  "dev-agent.status": DevAgentStatusPayload;
}

export interface ObservationEnvelope<TType extends ObservationEventType, TPayload> {
  protocolVersion: typeof OBSERVATION_PROTOCOL_VERSION;
  id: string;
  source: ObservationSource;
  type: TType;
  observedAt: number;
  sensitivity: ObservationSensitivity;
  payload: TPayload;
  correlationId?: string;
}

export type ObservationEvent = {
  [K in ObservationEventType]: ObservationEnvelope<K, ObservationPayloadMap[K]>;
}[ObservationEventType];

export type ObservationValidationResult =
  | { ok: true; event: ObservationEvent }
  | { ok: false; code: "invalid_event" | "payload_too_large"; reason: string };

export interface ObservationLimits {
  maxPayloadBytes: number;
  maxEventAgeMs: number;
  maxFutureSkewMs: number;
  dedupeWindowMs: number;
  maxEventsPerMinutePerSource: number;
  diagnosticCapacity: number;
}

export interface ObservationSourceGrant {
  source: ObservationSource;
  eventTypes: readonly ObservationEventType[];
  maxSensitivity: ObservationSensitivity;
}

export interface ObservationRuntimeConfig {
  enabled: boolean;
  diagnosticsEnabled: boolean;
  grants: readonly ObservationSourceGrant[];
  /** 角色模式对一次性环境反应冷却的倍率；持续媒体状态不受影响。 */
  cooldownMultiplier?: number;
  quietHours?: {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
  };
}

export type ObservationRejectionCode =
  | "paused"
  | "quiet_hours"
  | "source_not_allowed"
  | "event_not_allowed"
  | "sensitivity_not_allowed"
  | "stale_event"
  | "future_event"
  | "duplicate_event"
  | "rate_limited"
  | "invalid_event"
  | "payload_too_large"
  | "unsupported_reaction";

export type ObservationIngestResult =
  | { status: "scheduled"; eventId: string; action: ActionRequest }
  | { status: "ignored"; eventId: string; reason: string }
  | { status: "rejected"; eventId?: string; code: ObservationRejectionCode; reason: string };

export interface ObservationDiagnostic {
  receivedAt: number;
  eventId: string;
  sourceKind: ObservationSource["kind"] | "unknown";
  sourceId: string;
  eventType: ObservationEventType | "unknown";
  outcome: ObservationIngestResult["status"];
  actionType?: ActionRequest["type"];
  code?: ObservationRejectionCode;
  reason?: string;
}

export interface ObservationReaction {
  type: ActionRequest["type"];
  payload: Record<string, unknown>;
  cooldownMs: number;
}
