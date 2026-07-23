import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ObservationSettings } from "../domain/settings/types";
import type { ObservationSourceGrant } from "../domain/observations/types";
import { usePetRuntime } from "../hooks/usePetRuntime";
import { OBSERVATION_PROTOCOL_VERSION } from "../domain/observations/types";
import { isWithinQuietHours } from "../domain/observations/policy";
import {
  parseInstalledPlugins,
  pluginGrants,
  type InstalledPlugin,
} from "../domain/plugins/types";

const WINDOWS_MEDIA_SOURCE: ObservationSourceGrant = {
  source: { kind: "system", id: "windows-media-session" },
  eventTypes: ["media.playback"],
  maxSensitivity: "status",
};

const DEV_CONSOLE_SOURCE: ObservationSourceGrant = {
  source: { kind: "system", id: "debug-console" },
  eventTypes: ["media.playback", "dev-agent.status"],
  maxSensitivity: "status",
};

/**
 * 将持久化设置应用到主窗口唯一的 ObservationHost。
 * 第三方插件授权不会在这里使用通配符，M13-C 将由插件注册表逐项加入 grant。
 */
export default function ObservationRuntimeBridge({ settings }: { settings: ObservationSettings | null }) {
  const { observationHost, renderer } = usePetRuntime();
  const enabled = settings?.enabled ?? false;
  const systemMediaEnabled = settings?.systemMediaEnabled ?? false;
  const musicReactionIntensity = settings?.musicReactionIntensity ?? 0.55;
  const diagnosticsEnabled = settings?.diagnosticsEnabled ?? true;
  const quietHoursEnabled = settings?.quietHoursEnabled ?? false;
  const quietHoursStartMinute = settings?.quietHoursStartMinute ?? 22 * 60;
  const quietHoursEndMinute = settings?.quietHoursEndMinute ?? 8 * 60;
  const [safetyPaused, setSafetyPaused] = useState(false);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [localMinute, setLocalMinute] = useState(() => currentLocalMinute());
  const reducedMotion = usePrefersReducedMotion();
  const mediaEventCounter = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen("agent-stop-all", () => {
      // 总开关本来就是关闭状态时，不让一次安全停止污染未来的首次启用。
      if (enabledRef.current) setSafetyPaused(true);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!enabled) setSafetyPaused(false);
  }, [enabled]);

  useEffect(() => {
    if (!quietHoursEnabled) return;
    const updateMinute = () => setLocalMinute(currentLocalMinute());
    updateMinute();
    const timer = window.setInterval(updateMinute, 30_000);
    return () => window.clearInterval(timer);
  }, [quietHoursEnabled]);

  const quietNow = quietHoursEnabled && isWithinQuietHours(
    localMinute,
    quietHoursStartMinute,
    quietHoursEndMinute,
  );
  const mediaObserverEnabled = enabled
    && systemMediaEnabled
    && !safetyPaused
    && !quietNow
    && !reducedMotion
    && musicReactionIntensity > 0;

  useEffect(() => {
    let active = true;
    let unlistenPlugins: (() => void) | undefined;
    let unlistenEvents: (() => void) | undefined;
    void invoke<unknown>("plugin_list")
      .then((value) => {
        if (active) setPlugins(parseInstalledPlugins(value));
      })
      .catch((error: unknown) => console.error("读取创作者插件失败：", error));
    void listen<unknown>("plugins-changed", (event) => {
      if (active) setPlugins(parseInstalledPlugins(event.payload));
    }).then((cleanup) => {
      if (active) unlistenPlugins = cleanup;
      else cleanup();
    }).catch((error: unknown) => console.error("监听插件状态失败：", error));
    void listen<unknown>("plugin-observation-event", (event) => {
      observationHost.ingest(event.payload);
    }).then((cleanup) => {
      if (active) unlistenEvents = cleanup;
      else cleanup();
    }).catch((error: unknown) => console.error("监听插件观察事件失败：", error));
    return () => {
      active = false;
      unlistenPlugins?.();
      unlistenEvents?.();
    };
  }, [observationHost]);

  useEffect(() => {
    const grants: ObservationSourceGrant[] = [];
    if (systemMediaEnabled) grants.push(WINDOWS_MEDIA_SOURCE);
    if (import.meta.env.DEV) grants.push(DEV_CONSOLE_SOURCE);
    grants.push(...pluginGrants(plugins));
    observationHost.configure({
      enabled: enabled && !safetyPaused,
      diagnosticsEnabled,
      grants,
      quietHours: {
        enabled: quietHoursEnabled,
        startMinute: quietHoursStartMinute,
        endMinute: quietHoursEndMinute,
      },
    });
    return () => {
      observationHost.configure({ enabled: false, diagnosticsEnabled, grants: [] });
    };
  }, [
    diagnosticsEnabled,
    enabled,
    observationHost,
    plugins,
    quietHoursEnabled,
    quietHoursEndMinute,
    quietHoursStartMinute,
    safetyPaused,
    systemMediaEnabled,
  ]);

  useEffect(() => {
    let active = true;
    let unlistenPlayback: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    void listen<{ state: "playing" | "paused" | "stopped" }>(
      "system-media-playback",
      (event) => {
        mediaEventCounter.current += 1;
        observationHost.ingest({
          protocolVersion: OBSERVATION_PROTOCOL_VERSION,
          id: `windows-media-${Date.now()}-${mediaEventCounter.current}`,
          source: { kind: "system", id: "windows-media-session" },
          type: "media.playback",
          observedAt: Date.now(),
          sensitivity: "status",
          payload: { state: event.payload.state },
        });
      },
    ).then((cleanup) => {
      if (active) unlistenPlayback = cleanup;
      else cleanup();
    }).catch((error: unknown) => console.error("监听系统媒体状态失败：", error));
    void listen<{ available: boolean; reason: string | null }>(
      "system-media-observer-status",
      (event) => {
        if (!event.payload.available && event.payload.reason) {
          console.warn(event.payload.reason);
        }
      },
    ).then((cleanup) => {
      if (active) unlistenStatus = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlistenPlayback?.();
      unlistenStatus?.();
    };
  }, [observationHost]);

  useEffect(() => {
    if (!mediaObserverEnabled) renderer.setMediaReaction("stopped");
    void invoke("media_set_observation_enabled", { enabled: mediaObserverEnabled })
      .catch((error: unknown) => console.error("切换系统媒体观察失败：", error));
  }, [mediaObserverEnabled, renderer]);

  useEffect(() => () => {
    renderer.setMediaReaction("stopped");
    void invoke("media_set_observation_enabled", { enabled: false }).catch(() => undefined);
  }, [renderer]);

  return null;
}

function currentLocalMinute(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}
