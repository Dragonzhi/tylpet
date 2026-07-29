import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AudioSettings, SpeechSettings } from "../domain/settings/types";
import type { ActionRequest } from "../domain/actions/types";
import { usePetRuntime } from "../hooks/usePetRuntime";

interface SpeechReadRequest {
  id: string;
  text: string;
}

export default function SpeechRuntimeBridge({
  speech,
  audio,
  enabledByMode,
}: {
  speech: SpeechSettings | null;
  audio: AudioSettings | null;
  enabledByMode: boolean;
}) {
  const { speechController, scheduler } = usePetRuntime();
  const reducedMotion = usePrefersReducedMotion();
  const enabled = Boolean(enabledByMode && speech?.enabled && audio?.enabled && audio.volume > 0);

  useEffect(() => {
    speechController.configure({
      enabled,
      volume: audio?.volume ?? 0,
      rate: speech?.rate ?? 1,
      pitch: speech?.pitch ?? 1,
      voiceUri: speech?.voiceUri ?? "",
      reducedMotion,
    });
  }, [audio?.volume, enabled, reducedMotion, speech?.pitch, speech?.rate, speech?.voiceUri, speechController]);

  useEffect(() => {
    let active = true;
    const cleanups: Array<() => void> = [];
    const install = async () => {
      cleanups.push(await listen<unknown>("speech-read-request", (event) => {
        const request = parseReadRequest(event.payload);
        if (!request || !enabled || !speechController.isAvailable()) return;
        const action: ActionRequest = {
          id: request.id,
          type: "speech.say",
          payload: { text: request.text, interrupt: true },
          source: "user",
          requestedAt: Date.now(),
        };
        scheduler.submit(action, { channel: "speech", priority: "user" });
      }));
      cleanups.push(await listen("speech-stop-request", () => {
        scheduler.cancelChannel("speech");
        speechController.stop();
      }));
      if (!active) cleanups.splice(0).forEach((cleanup) => cleanup());
    };
    void install().catch((error: unknown) => console.error("安装语音运行时桥接失败：", error));
    return () => {
      active = false;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, [enabled, scheduler, speechController]);

  return null;
}

function parseReadRequest(input: unknown): SpeechReadRequest | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) return null;
  if (typeof value.text !== "string") return null;
  const text = value.text.trim();
  if (text.length === 0 || Array.from(text).length > 500) return null;
  return { id: value.id, text };
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
