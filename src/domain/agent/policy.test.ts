import { describe, expect, it } from "vitest";
import { AGENT_LIMITS } from "../../config/agent";
import type { ActionRequest } from "../actions/types";
import { AgentActionPolicy } from "./policy";

function action(type: ActionRequest["type"], id: string = type): ActionRequest {
  const payloadByType = {
    "motion.play": { motion: "wave", speed: 1 },
    "expression.set": { expression: "normal" },
    "look.set": { x: 0, y: 0 },
    "window.move": { target: { kind: "semantic", position: "right" }, durationMs: 1000 },
    "outfit.equip": { outfitId: "x" },
    "speech.say": { text: "x", interrupt: true },
    "timer.start": { durationMs: 60_000 },
    "timer.pause": { timerId: "t" },
    "timer.resume": { timerId: "t" },
    "timer.cancel": { timerId: "t" },
    wait: { durationMs: 1 },
  } as const;
  return { id, type, payload: payloadByType[type], source: "agent", requestedAt: 0 } as ActionRequest;
}

describe("AgentActionPolicy", () => {
  it("rejects actions while Agent is disabled", () => {
    const policy = new AgentActionPolicy(AGENT_LIMITS, () => 0);
    expect(policy.authorize(action("motion.play"), { enabled: false, confirmed: false }))
      .toMatchObject({ allowed: false, errorCode: "permission_denied" });
  });

  it("requires per-action confirmation for window movement", () => {
    const policy = new AgentActionPolicy(AGENT_LIMITS, () => 0);
    expect(policy.authorize(action("window.move"), { enabled: true, confirmed: false }))
      .toMatchObject({ allowed: false, errorCode: "confirmation_required" });
    expect(policy.authorize(action("window.move"), { enabled: true, confirmed: true }).allowed).toBe(true);
  });

  it("enforces cooldown and rolling per-minute rate limits", () => {
    let now = 0;
    const limits = { ...AGENT_LIMITS, maxActionsPerMinute: 2, cooldownMs: { "motion.play": 100 } };
    const policy = new AgentActionPolicy(limits, () => now);
    expect(policy.authorize(action("motion.play", "a"), { enabled: true, confirmed: false }).allowed).toBe(true);
    now = 50;
    expect(policy.authorize(action("motion.play", "b"), { enabled: true, confirmed: false }))
      .toMatchObject({ errorCode: "cooldown_active" });
    now = 100;
    expect(policy.authorize(action("motion.play", "c"), { enabled: true, confirmed: false }).allowed).toBe(true);
    now = 200;
    expect(policy.authorize(action("look.set", "d"), { enabled: true, confirmed: false }))
      .toMatchObject({ errorCode: "rate_limit_exceeded" });
    now = 60_001;
    expect(policy.authorize(action("look.set", "e"), { enabled: true, confirmed: false }).allowed).toBe(true);
  });
});
