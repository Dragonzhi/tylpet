import { describe, expect, it } from "vitest";
import { COMPANION_CONFIG } from "../../config/companion";
import { resolveCompanionCueMotion } from "./catalog";
import {
  decideCompanionAction,
  scheduleNextCompanionCandidate,
  shouldResetCompanionSchedule,
} from "./policy";
import { parseChatAttentionEvent, type CompanionSnapshot } from "./types";

const NOW = 10_000_000;

function snapshot(partial: Partial<CompanionSnapshot> = {}): CompanionSnapshot {
  return {
    nowMs: NOW,
    mode: "companion",
    petState: "idle",
    lastUserInteractionAtMs: NOW - 1_000_000,
    nextCandidateAtMs: NOW - 1,
    actionHistory: [],
    availableMotions: ["bow", "stretch", "wave"],
    bodyMotionBusy: false,
    reducedMotion: false,
    autonomyEnabled: true,
    idleFrequency: "low",
    ...partial,
  };
}

describe("CompanionDirector 纯策略", () => {
  it("关闭总开关或进入安静/休眠时不会产生动作", () => {
    expect(decideCompanionAction(snapshot({ autonomyEnabled: false }), () => 0))
      .toEqual({ kind: "skip", reason: "disabled" });
    for (const mode of ["quiet", "sleep"] as const) {
      expect(decideCompanionAction(snapshot({ mode }), () => 0))
        .toEqual({ kind: "skip", reason: "mode-blocked" });
    }
  });

  it("用户保护期、候选时间和忙碌状态都会延后而不是排队", () => {
    expect(decideCompanionAction(snapshot({
      lastUserInteractionAtMs: NOW - 1_000,
    }), () => 0)).toMatchObject({ kind: "wait", reason: "protection" });
    expect(decideCompanionAction(snapshot({
      nextCandidateAtMs: NOW + 20_000,
    }), () => 0)).toEqual({
      kind: "wait",
      nextCheckAtMs: NOW + 20_000,
      reason: "not-due",
    });
    expect(decideCompanionAction(snapshot({ bodyMotionBusy: true }), () => 0))
      .toMatchObject({ kind: "wait", reason: "busy" });
    expect(decideCompanionAction(snapshot({ petState: "listen" }), () => 0))
      .toMatchObject({ kind: "wait", reason: "busy" });
  });

  it("只从实际存在的 wave、bow、stretch 中选择并避免连续重复", () => {
    expect(decideCompanionAction(snapshot({ availableMotions: ["stretch"] }), () => 0))
      .toMatchObject({ kind: "act", cue: "idle.stretch", motion: "stretch" });
    const decision = decideCompanionAction(snapshot({
      actionHistory: [{ motion: "stretch", startedAtMs: NOW - COMPANION_CONFIG.sameMotionCooldownMs - 1 }],
    }), () => 0);
    expect(decision).toMatchObject({ kind: "act" });
    if (decision.kind === "act") expect(decision.motion).not.toBe("stretch");
  });

  it("动作冷却与小时预算到达时返回下一次可检查时间", () => {
    const cooldown = decideCompanionAction(snapshot({
      availableMotions: ["stretch"],
      actionHistory: [{ motion: "stretch", startedAtMs: NOW - 1_000 }],
    }), () => 0);
    expect(cooldown).toEqual({
      kind: "wait",
      nextCheckAtMs: NOW - 1_000 + COMPANION_CONFIG.sameMotionCooldownMs,
      reason: "motion-cooldown",
    });

    const actionHistory = Array.from({ length: 6 }, (_, index) => ({
      motion: ["stretch", "wave", "bow"][index % 3],
      startedAtMs: NOW - 50_000 + index * 1_000,
    }));
    expect(decideCompanionAction(snapshot({ actionHistory }), () => 0))
      .toMatchObject({ kind: "wait", reason: "hourly-budget" });
  });

  it("候选时间使用可注入随机源且专注模式明显更慢", () => {
    expect(scheduleNextCompanionCandidate(NOW, "companion", "low", () => 0))
      .toBe(NOW + 8 * 60_000);
    expect(scheduleNextCompanionCandidate(NOW, "companion", "low", () => 1))
      .toBe(NOW + 15 * 60_000);
    expect(scheduleNextCompanionCandidate(NOW, "focus", "low", () => 0))
      .toBe(NOW + 18 * 60_000);
  });

  it("系统休眠造成计时器明显过期时重新排期而不补播", () => {
    expect(shouldResetCompanionSchedule(
      NOW + COMPANION_CONFIG.suspensionOvershootMs,
      NOW,
    )).toBe(false);
    expect(shouldResetCompanionSchedule(
      NOW + COMPANION_CONFIG.suspensionOvershootMs + 1,
      NOW,
    )).toBe(true);
  });

  it("语义动作目录提供稳定降级", () => {
    expect(resolveCompanionCueMotion("task.complete", ["bow"])).toBe("bow");
    expect(resolveCompanionCueMotion("task.failed", ["wave"])).toBeNull();
  });

  it("聊天注意状态只接受不含正文的枚举", () => {
    expect(parseChatAttentionEvent({ state: "listening" })).toEqual({ state: "listening" });
    expect(parseChatAttentionEvent({ state: "typing", text: "secret" })).toBeNull();
    expect(parseChatAttentionEvent("listening")).toBeNull();
  });
});
