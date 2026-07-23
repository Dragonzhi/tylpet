export type ObservationEventType = "dev-agent.status" | "media.playback";
export type ObservationSensitivity = "status" | "metadata" | "content";
export type DevAgentState =
  | "session_started"
  | "working"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "stopped";

export interface PluginManifestV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  hostCompatibility: string;
  entry: { type: "observation-source" };
  permissions: {
    observationEvents: ObservationEventType[];
    maxSensitivity: ObservationSensitivity;
  };
  settingsSchema?: Record<string, unknown>;
}

export interface PluginObservationEventV1 {
  type: ObservationEventType;
  sensitivity: ObservationSensitivity;
  payload: { state: string };
  correlationId?: string;
}
