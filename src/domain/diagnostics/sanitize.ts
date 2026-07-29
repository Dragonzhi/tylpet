import type { ObservationDiagnostic } from "../observations/types";
import type { SchedulerEvent } from "../scheduler/types";
import type {
  SanitizedObservationDiagnostic,
  SanitizedSchedulerDiagnostic,
} from "./types";

export function sanitizeSchedulerEvent(
  event: SchedulerEvent,
): SanitizedSchedulerDiagnostic {
  return {
    timestamp: event.timestamp,
    actionType: event.actionType,
    source: event.source,
    channel: event.channel,
    priority: event.priority,
    outcome: event.type,
  };
}

export function sanitizeObservationDiagnostic(
  event: ObservationDiagnostic,
): SanitizedObservationDiagnostic {
  return {
    receivedAt: event.receivedAt,
    sourceKind: event.sourceKind,
    eventType: event.eventType,
    outcome: event.outcome,
    ...(event.actionType ? { actionType: event.actionType } : {}),
    ...(event.code ? { code: event.code } : {}),
  };
}
