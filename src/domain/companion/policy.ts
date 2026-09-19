import { COMPANION_CONFIG } from "../../config/companion";
import type { BehaviorMode, CompanionIdleFrequency } from "../settings/types";
import {
  chooseWeightedMotion,
  getAvailableAmbientChoices,
} from "./catalog";
import type {
  CompanionActionRecord,
  CompanionDecision,
  CompanionSnapshot,
} from "./types";

export function scheduleNextCompanionCandidate(
  nowMs: number,
  mode: BehaviorMode,
  frequency: CompanionIdleFrequency,
  random: () => number,
): number {
  const timing = getActiveModeTiming(mode);
  if (!timing) return nowMs + COMPANION_CONFIG.unavailableRetryMs;
  const interval = timing.intervalMs[frequency];
  const sample = normalizeRandom(random());
  return nowMs + interval.minimum + (interval.maximum - interval.minimum) * sample;
}

export function shouldResetCompanionSchedule(
  nowMs: number,
  scheduledAtMs: number,
): boolean {
  return nowMs - scheduledAtMs > COMPANION_CONFIG.suspensionOvershootMs;
}

export function decideCompanionAction(
  snapshot: CompanionSnapshot,
  random: () => number,
): CompanionDecision {
  if (!snapshot.autonomyEnabled) return { kind: "skip", reason: "disabled" };

  const timing = getActiveModeTiming(snapshot.mode);
  if (!timing) return { kind: "skip", reason: "mode-blocked" };

  if (snapshot.petState !== "idle" || snapshot.bodyMotionBusy) {
    return {
      kind: "wait",
      nextCheckAtMs: snapshot.nowMs + COMPANION_CONFIG.busyRetryMs,
      reason: "busy",
    };
  }

  const protectionEndsAt = snapshot.lastUserInteractionAtMs + timing.graceMs;
  if (snapshot.nowMs < protectionEndsAt) {
    return { kind: "wait", nextCheckAtMs: protectionEndsAt, reason: "protection" };
  }

  if (snapshot.nowMs < snapshot.nextCandidateAtMs) {
    return {
      kind: "wait",
      nextCheckAtMs: snapshot.nextCandidateAtMs,
      reason: "not-due",
    };
  }

  const recentWindow = snapshot.actionHistory.filter(
    (record) => snapshot.nowMs - record.startedAtMs < COMPANION_CONFIG.budgetWindowMs,
  );
  if (recentWindow.length >= timing.maxActionsPerWindow) {
    return {
      kind: "wait",
      nextCheckAtMs: recentWindow[0].startedAtMs + COMPANION_CONFIG.budgetWindowMs,
      reason: "hourly-budget",
    };
  }

  const availableChoices = getAvailableAmbientChoices(snapshot.availableMotions);
  if (availableChoices.length === 0) return { kind: "skip", reason: "no-motion" };

  const cooldownEligible = availableChoices.filter((choice) => {
    const latest = latestMotionRecord(snapshot.actionHistory, choice.motion);
    return !latest
      || snapshot.nowMs - latest.startedAtMs >= COMPANION_CONFIG.sameMotionCooldownMs;
  });
  if (cooldownEligible.length === 0) {
    const earliest = Math.min(...availableChoices.map((choice) => {
      const latest = latestMotionRecord(snapshot.actionHistory, choice.motion);
      return (latest?.startedAtMs ?? snapshot.nowMs) + COMPANION_CONFIG.sameMotionCooldownMs;
    }));
    return { kind: "wait", nextCheckAtMs: earliest, reason: "motion-cooldown" };
  }

  const previousMotion = snapshot.actionHistory[snapshot.actionHistory.length - 1]?.motion;
  const withoutImmediateRepeat = cooldownEligible.length > 1
    ? cooldownEligible.filter((choice) => choice.motion !== previousMotion)
    : cooldownEligible;
  const selected = chooseWeightedMotion(
    withoutImmediateRepeat.length > 0 ? withoutImmediateRepeat : cooldownEligible,
    random,
  );
  if (!selected) return { kind: "skip", reason: "no-motion" };

  return {
    kind: "act",
    cue: selected.cue,
    motion: selected.motion,
    speed: snapshot.reducedMotion ? Math.min(selected.speed, 0.8) : selected.speed,
    cooldownKey: `companion:${selected.motion}`,
  };
}

function getActiveModeTiming(mode: BehaviorMode) {
  return mode === "companion" || mode === "focus"
    ? COMPANION_CONFIG.mode[mode]
    : null;
}

function latestMotionRecord(
  history: readonly CompanionActionRecord[],
  motion: string,
): CompanionActionRecord | undefined {
  return [...history].reverse().find((record) => record.motion === motion);
}

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
