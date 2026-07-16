import { describe, expect, it } from "vitest";
import { comparePriority, getDefaultPriority, shareMutexGroup, getDefaultChannel, shouldPreempt } from "./channelPolicy";
import type { ActionSource, ActionRequest } from "../actions/types";

describe("优先级", () => {
  it("safety-stop 优先级最高", () => {
    expect(comparePriority("safety-stop", "user")).toBeGreaterThan(0);
  });

  it("user 高于 menu", () => {
    expect(comparePriority("user", "menu")).toBeGreaterThan(0);
  });

  it("menu 高于 timer", () => {
    expect(comparePriority("menu", "timer")).toBeGreaterThan(0);
  });

  it("timer 高于 agent", () => {
    expect(comparePriority("timer", "agent")).toBeGreaterThan(0);
  });

  it("agent 高于 idle", () => {
    expect(comparePriority("agent", "idle")).toBeGreaterThan(0);
  });

  it("相同优先级返回 0", () => {
    expect(comparePriority("user", "user")).toBe(0);
  });
});

describe("默认优先级", () => {
  it("user 来源默认优先级为 user", () => {
    expect(getDefaultPriority("user")).toBe("user");
  });

  it("agent 来源默认优先级为 agent", () => {
    expect(getDefaultPriority("agent")).toBe("agent");
  });

  it("timer 来源默认优先级为 timer", () => {
    expect(getDefaultPriority("timer")).toBe("timer");
  });

  it("system 来源默认优先级为 safety-stop", () => {
    expect(getDefaultPriority("system")).toBe("safety-stop");
  });

  it("dev 来源默认优先级为 idle", () => {
    expect(getDefaultPriority("dev")).toBe("idle");
  });
});

describe("互斥组", () => {
  it("body-motion 和 outfit 共享互斥组", () => {
    expect(shareMutexGroup("body-motion", "outfit")).toBe(true);
  });

  it("body-motion 和 gaze-expression 不共享互斥组", () => {
    expect(shareMutexGroup("body-motion", "gaze-expression")).toBe(false);
  });

  it("locomotion 独立互斥组", () => {
    expect(shareMutexGroup("locomotion", "body-motion")).toBe(false);
  });
});

describe("默认通道", () => {
  it("motion.play 默认在 body-motion 通道", () => {
    expect(getDefaultChannel("motion.play")).toBe("body-motion");
  });

  it("window.move 默认在 locomotion 通道", () => {
    expect(getDefaultChannel("window.move")).toBe("locomotion");
  });

  it("look.set 默认在 gaze-expression 通道", () => {
    expect(getDefaultChannel("look.set")).toBe("gaze-expression");
  });

  it("outfit.equip 默认在 outfit 通道", () => {
    expect(getDefaultChannel("outfit.equip")).toBe("outfit");
  });

  it("speech.say 默认在 speech 通道", () => {
    expect(getDefaultChannel("speech.say")).toBe("speech");
  });

  it("wait 没有默认通道", () => {
    expect(getDefaultChannel("wait")).toBeUndefined();
  });
});

describe("抢占规则", () => {
  it("高优先级抢占低优先级", () => {
    // Build a minimal action request for a body-motion action
    const action = { id: "test", type: "motion.play", payload: {}, source: "user" as ActionSource, requestedAt: 1000 };
    expect(shouldPreempt(action as unknown as ActionRequest, "user", "agent", "body-motion")).toBe(true);
  });

  it("低优先级不抢占高优先级", () => {
    const action = { id: "test", type: "motion.play", payload: {}, source: "agent" as ActionSource, requestedAt: 1000 };
    expect(shouldPreempt(action as unknown as ActionRequest, "agent", "user", "body-motion")).toBe(false);
  });

  it("相同优先级不抢占（FIFO）", () => {
    const action = { id: "test", type: "motion.play", payload: {}, source: "user" as ActionSource, requestedAt: 1000 };
    expect(shouldPreempt(action as unknown as ActionRequest, "user", "user", "body-motion")).toBe(false);
  });

  it("speech 通道 interrupt=true 时相同优先级抢占", () => {
    const action = { id: "test", type: "speech.say", payload: { interrupt: true }, source: "agent" as ActionSource, requestedAt: 1000 };
    expect(shouldPreempt(action as unknown as ActionRequest, "agent", "agent", "speech")).toBe(true);
  });

  it("speech 通道 interrupt=false 时相同优先级不抢占", () => {
    const action = { id: "test", type: "speech.say", payload: { interrupt: false }, source: "agent" as ActionSource, requestedAt: 1000 };
    expect(shouldPreempt(action as unknown as ActionRequest, "agent", "agent", "speech")).toBe(false);
  });

  it("非 speech 通道忽略 interrupt 标志", () => {
    const action = { id: "test", type: "motion.play", payload: { interrupt: true }, source: "user" as ActionSource, requestedAt: 1000 };
    expect(shouldPreempt(action as unknown as ActionRequest, "user", "user", "body-motion")).toBe(false);
  });
});
