import type { BehaviorMode } from "../settings/types";
import type { SchedulerEvent } from "../scheduler/types";
import type { ObservationDiagnostic } from "../observations/types";

export interface RuntimeDiagnosticsRequest {
  requestId: string;
}

export interface SanitizedSchedulerDiagnostic {
  timestamp: number;
  actionType: SchedulerEvent["actionType"];
  source: SchedulerEvent["source"];
  channel: SchedulerEvent["channel"];
  priority: SchedulerEvent["priority"];
  outcome: SchedulerEvent["type"];
}

export interface SanitizedObservationDiagnostic {
  receivedAt: number;
  sourceKind: ObservationDiagnostic["sourceKind"];
  eventType: ObservationDiagnostic["eventType"];
  outcome: ObservationDiagnostic["outcome"];
  actionType?: ObservationDiagnostic["actionType"];
  code?: ObservationDiagnostic["code"];
}

export interface RuntimeDiagnosticsSnapshot {
  capturedAt: number;
  behaviorMode: BehaviorMode;
  schedulerEvents: SanitizedSchedulerDiagnostic[];
  observationEvents: SanitizedObservationDiagnostic[];
}

export interface RuntimeDiagnosticsResponse {
  requestId: string;
  snapshot: RuntimeDiagnosticsSnapshot;
}
