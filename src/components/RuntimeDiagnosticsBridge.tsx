import { useEffect, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { BehaviorMode } from "../domain/settings/types";
import type {
  RuntimeDiagnosticsRequest,
  RuntimeDiagnosticsResponse,
  SanitizedSchedulerDiagnostic,
} from "../domain/diagnostics/types";
import {
  sanitizeObservationDiagnostic,
  sanitizeSchedulerEvent,
} from "../domain/diagnostics/sanitize";
import { usePetRuntime } from "../hooks/usePetRuntime";

const DIAGNOSTIC_CAPACITY = 80;

export default function RuntimeDiagnosticsBridge({
  behaviorMode,
}: {
  behaviorMode: BehaviorMode;
}) {
  const { scheduler, observationHost } = usePetRuntime();
  const modeRef = useRef(behaviorMode);
  const schedulerEventsRef = useRef<SanitizedSchedulerDiagnostic[]>([]);
  modeRef.current = behaviorMode;

  useEffect(() => scheduler.onEvent((event) => {
    schedulerEventsRef.current = [
      ...schedulerEventsRef.current,
      sanitizeSchedulerEvent(event),
    ].slice(-DIAGNOSTIC_CAPACITY);
  }), [scheduler]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<RuntimeDiagnosticsRequest>("runtime-diagnostics-request", (event) => {
      const response: RuntimeDiagnosticsResponse = {
        requestId: event.payload.requestId,
        snapshot: {
          capturedAt: Date.now(),
          behaviorMode: modeRef.current,
          schedulerEvents: [...schedulerEventsRef.current],
          observationEvents: observationHost.getDiagnostics()
            .slice(-DIAGNOSTIC_CAPACITY)
            .map(sanitizeObservationDiagnostic),
        },
      };
      void emitTo("settings", "runtime-diagnostics-response", response)
        .catch(() => undefined);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [observationHost]);

  return null;
}
