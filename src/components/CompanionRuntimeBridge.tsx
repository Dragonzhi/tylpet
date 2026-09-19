import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { COMPANION_CONFIG } from "../config/companion";
import type {
  BehaviorMode,
  CompanionSettings,
} from "../domain/settings/types";
import type { ActionRequest } from "../domain/actions/types";
import type { SchedulerEvent } from "../domain/scheduler/types";
import {
  decideCompanionAction,
  scheduleNextCompanionCandidate,
  shouldResetCompanionSchedule,
} from "../domain/companion/policy";
import {
  CHAT_ATTENTION_EVENT,
  parseChatAttentionEvent,
  type ChatAttentionState,
  type CompanionActionRecord,
  type CompanionPetState,
} from "../domain/companion/types";
import { getBehaviorModePolicy } from "../domain/behavior/modePolicy";
import { usePetRuntime } from "../hooks/usePetRuntime";

type EngagementState = "idle" | "listen" | "speak";

interface CompanionRuntimeBridgeProps {
  settings: CompanionSettings | null;
  mode: BehaviorMode;
  petState: CompanionPetState;
  lastUserInteractionAtMs: number;
  onEngagementStateChange: (state: EngagementState) => void;
  onUserActivity: () => void;
}

const TERMINAL_EVENTS = new Set<SchedulerEvent["type"]>([
  "completed",
  "interrupted",
  "rejected",
  "timed_out",
  "failed",
  "cancelled",
  "cooldown_rejected",
]);

/**
 * Preview.3 的本地陪伴运行时：只安排下一次检查并提交已有语义动作。
 * 选择策略位于纯函数 domain 层，这里不读取聊天正文或外部事件 payload。
 */
export default function CompanionRuntimeBridge({
  settings,
  mode,
  petState,
  lastUserInteractionAtMs,
  onEngagementStateChange,
  onUserActivity,
}: CompanionRuntimeBridgeProps) {
  const { scheduler, capabilities } = usePetRuntime();
  const reducedMotion = usePrefersReducedMotion();
  const [scheduleRevision, refreshSchedule] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const nextCandidateAtRef = useRef<number | null>(null);
  const actionHistoryRef = useRef<CompanionActionRecord[]>([]);
  const activeAmbientRef = useRef<{ id: string; motion: string; recorded: boolean } | null>(null);
  const chatAttentionRef = useRef<ChatAttentionState>("idle");
  const activeSpeechIdsRef = useRef(new Set<string>());
  const safetyStoppedRef = useRef(false);
  const previousUserEnabledRef = useRef(settings?.autonomyEnabled ?? false);
  const latestSettingsRef = useRef(settings);
  const latestModeRef = useRef(mode);
  latestSettingsRef.current = settings;
  latestModeRef.current = mode;

  const clearWakeTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const cancelAmbientAction = useCallback(() => {
    const active = activeAmbientRef.current;
    if (!active) return;
    activeAmbientRef.current = null;
    scheduler.cancel(active.id);
  }, [scheduler]);

  const publishEngagementState = useCallback(() => {
    if (activeSpeechIdsRef.current.size > 0) {
      onEngagementStateChange("speak");
      return;
    }
    onEngagementStateChange(chatAttentionRef.current === "idle" ? "idle" : "listen");
  }, [onEngagementStateChange]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen(CHAT_ATTENTION_EVENT, (event) => {
      const parsed = parseChatAttentionEvent(event.payload);
      if (!parsed) return;
      chatAttentionRef.current = parsed.state;
      onUserActivity();
      publishEngagementState();
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch((error: unknown) => {
      console.error("监听对话关注状态失败：", error);
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [onUserActivity, publishEngagementState]);

  useEffect(() => scheduler.onEvent((event) => {
    if (event.actionType === "speech.say") {
      if (event.type === "started") activeSpeechIdsRef.current.add(event.actionId);
      else if (TERMINAL_EVENTS.has(event.type)) activeSpeechIdsRef.current.delete(event.actionId);
      publishEngagementState();
    }

    const ambient = activeAmbientRef.current;
    if (!ambient || ambient.id !== event.actionId) return;
    if (event.type === "started" && !ambient.recorded) {
      ambient.recorded = true;
      actionHistoryRef.current = [
        ...actionHistoryRef.current,
        { motion: ambient.motion, startedAtMs: event.timestamp },
      ].slice(-32);
      return;
    }
    if (!TERMINAL_EVENTS.has(event.type)) return;

    activeAmbientRef.current = null;
    const current = latestSettingsRef.current;
    const currentMode = latestModeRef.current;
    nextCandidateAtRef.current = current
      ? scheduleNextCompanionCandidate(
        Date.now(),
        currentMode,
        current.idleFrequency,
        Math.random,
      )
      : null;
    refreshSchedule((value) => value + 1);
  }), [publishEngagementState, scheduler]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen("agent-stop-all", () => {
      safetyStoppedRef.current = true;
      clearWakeTimer();
      cancelAmbientAction();
      nextCandidateAtRef.current = null;
      refreshSchedule((value) => value + 1);
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [cancelAmbientAction, clearWakeTimer]);

  useEffect(() => {
    const userEnabled = settings?.autonomyEnabled ?? false;
    if (!userEnabled) {
      safetyStoppedRef.current = true;
    } else if (!previousUserEnabledRef.current) {
      safetyStoppedRef.current = false;
    }
    previousUserEnabledRef.current = userEnabled;
  }, [settings?.autonomyEnabled]);

  useEffect(() => {
    clearWakeTimer();
    cancelAmbientAction();
    if (!settings || safetyStoppedRef.current || !getBehaviorModePolicy(mode).allowAutonomy) {
      nextCandidateAtRef.current = null;
      return;
    }
    nextCandidateAtRef.current = scheduleNextCompanionCandidate(
      Date.now(),
      mode,
      settings.idleFrequency,
      Math.random,
    );
    refreshSchedule((value) => value + 1);
  }, [
    cancelAmbientAction,
    clearWakeTimer,
    lastUserInteractionAtMs,
    mode,
    settings,
  ]);

  const capabilitiesKey = capabilities.motions.join("\u0000");
  useEffect(() => {
    clearWakeTimer();
    if (!settings || safetyStoppedRef.current || activeAmbientRef.current) return;
    if (!getBehaviorModePolicy(mode).allowAutonomy || !settings.autonomyEnabled) return;
    if (petState !== "idle") return;

    const now = Date.now();
    const nextCandidateAt = nextCandidateAtRef.current
      ?? scheduleNextCompanionCandidate(now, mode, settings.idleFrequency, Math.random);
    nextCandidateAtRef.current = nextCandidateAt;

    const evaluate = () => {
      timerRef.current = undefined;
      const evaluatedAt = Date.now();
      const scheduledAt = nextCandidateAtRef.current ?? evaluatedAt;
      if (shouldResetCompanionSchedule(evaluatedAt, scheduledAt)) {
        nextCandidateAtRef.current = scheduleNextCompanionCandidate(
          evaluatedAt,
          mode,
          settings.idleFrequency,
          Math.random,
        );
        refreshSchedule((value) => value + 1);
        return;
      }
      const bodyMotionBusy = scheduler.getActiveActions().some(
        (action) => action.channel === "body-motion" || action.channel === "outfit",
      ) || scheduler.getPendingActions().some(
        (action) => action.channel === "body-motion" || action.channel === "outfit",
      );
      const decision = decideCompanionAction({
        nowMs: evaluatedAt,
        mode,
        petState,
        lastUserInteractionAtMs,
        nextCandidateAtMs: nextCandidateAtRef.current ?? Date.now(),
        actionHistory: actionHistoryRef.current,
        availableMotions: capabilities.motions,
        bodyMotionBusy,
        reducedMotion,
        autonomyEnabled: settings.autonomyEnabled,
        idleFrequency: settings.idleFrequency,
      }, Math.random);

      if (decision.kind === "wait") {
        nextCandidateAtRef.current = decision.nextCheckAtMs;
        refreshSchedule((value) => value + 1);
        return;
      }
      if (decision.kind === "skip") {
        nextCandidateAtRef.current = Date.now() + COMPANION_CONFIG.unavailableRetryMs;
        refreshSchedule((value) => value + 1);
        return;
      }

      const requestedAt = Date.now();
      const id = `companion-${decision.motion}-${requestedAt}`;
      const action: ActionRequest = {
        id,
        type: "motion.play",
        payload: { motion: decision.motion, speed: decision.speed },
        source: "ambient",
        requestedAt,
        timeoutMs: 20_000,
        correlationId: decision.cooldownKey,
      };
      activeAmbientRef.current = { id, motion: decision.motion, recorded: false };
      nextCandidateAtRef.current = null;
      try {
        scheduler.submit(action, { channel: "body-motion", priority: "idle" });
      } catch (error) {
        activeAmbientRef.current = null;
        nextCandidateAtRef.current = Date.now() + COMPANION_CONFIG.unavailableRetryMs;
        console.error("提交本地陪伴动作失败：", error);
        refreshSchedule((value) => value + 1);
      }
    };

    const delay = Math.max(0, Math.min(2_147_483_647, nextCandidateAt - now));
    timerRef.current = window.setTimeout(evaluate, delay);
    return clearWakeTimer;
  }, [
    capabilitiesKey,
    clearWakeTimer,
    lastUserInteractionAtMs,
    mode,
    petState,
    reducedMotion,
    scheduleRevision,
    scheduler,
    settings,
  ]);

  useEffect(() => () => {
    clearWakeTimer();
    cancelAmbientAction();
    activeSpeechIdsRef.current.clear();
  }, [cancelAmbientAction, clearWakeTimer]);

  return null;
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
