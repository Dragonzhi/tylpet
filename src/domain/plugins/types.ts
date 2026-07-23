import type {
  ObservationEventType,
  ObservationSensitivity,
  ObservationSourceGrant,
} from "../observations/types";

export interface PluginManifest {
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

export interface ManifestInspection {
  inspectionToken: string;
  manifest: PluginManifest;
  permissionChanges: string[];
  replacesExisting: boolean;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  observationEvents: ObservationEventType[];
  maxSensitivity: ObservationSensitivity;
  credentialPath: string;
}

const EVENT_TYPES = new Set<ObservationEventType>([
  "dev-agent.status",
  "media.playback",
]);
const SENSITIVITIES = new Set<ObservationSensitivity>([
  "status",
  "metadata",
  "content",
]);

/**
 * 原生插件注册表进入 WebView 后的第二道边界校验。
 * 未知字段不会被转成授权，避免前端因为损坏事件扩大 grant。
 */
export function parseInstalledPlugins(input: unknown): InstalledPlugin[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value): InstalledPlugin[] => {
    if (!isRecord(value)
      || typeof value.id !== "string"
      || typeof value.name !== "string"
      || typeof value.version !== "string"
      || typeof value.enabled !== "boolean"
      || typeof value.credentialPath !== "string"
      || !Array.isArray(value.observationEvents)
      || typeof value.maxSensitivity !== "string"
      || !SENSITIVITIES.has(value.maxSensitivity as ObservationSensitivity)) {
      return [];
    }
    const observationEvents = value.observationEvents.filter(
      (eventType): eventType is ObservationEventType =>
        typeof eventType === "string" && EVENT_TYPES.has(eventType as ObservationEventType),
    );
    if (observationEvents.length !== value.observationEvents.length || observationEvents.length === 0) {
      return [];
    }
    return [{
      id: value.id,
      name: value.name,
      version: value.version,
      enabled: value.enabled,
      observationEvents,
      maxSensitivity: value.maxSensitivity as ObservationSensitivity,
      credentialPath: value.credentialPath,
    }];
  });
}

export function pluginGrants(plugins: readonly InstalledPlugin[]): ObservationSourceGrant[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .map((plugin) => ({
      source: { kind: "plugin", id: plugin.id },
      eventTypes: plugin.observationEvents,
      maxSensitivity: plugin.maxSensitivity,
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
