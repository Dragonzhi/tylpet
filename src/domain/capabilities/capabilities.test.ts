import { describe, expect, it } from "vitest";
import { isActionSupported } from "./capabilities";
import type { ActionRequest } from "../actions/types";

function makeRequest(overrides: Partial<ActionRequest> & { type: ActionRequest["type"]; payload: Record<string, unknown> }): ActionRequest {
  return {
    id: "test-1",
    source: "dev",
    requestedAt: Date.now(),
    ...overrides,
  } as ActionRequest;
}

describe("isActionSupported", () => {
  it("渲染器支持的动作返回 true", () => {
    const action = makeRequest({
      type: "motion.play",
      payload: { motion: "wave" },
    });
    const capabilities = {
      renderer: {
        motions: ["wave", "blink"] as readonly string[],
        expressions: [] as readonly string[],
        lookDirection: false,
        outfits: [] as readonly string[],
      },
    };
    expect(isActionSupported(action, capabilities)).toBe(true);
  });

  it("渲染器不支持的动作返回 false", () => {
    const action = makeRequest({
      type: "motion.play",
      payload: { motion: "unknown" },
    });
    const capabilities = {
      renderer: {
        motions: ["wave", "blink"] as readonly string[],
        expressions: [] as readonly string[],
        lookDirection: false,
        outfits: [] as readonly string[],
      },
    };
    expect(isActionSupported(action, capabilities)).toBe(false);
  });

  it("无渲染器时需要渲染器的动作返回 false", () => {
    const action = makeRequest({
      type: "motion.play",
      payload: { motion: "wave" },
    });
    expect(isActionSupported(action, {})).toBe(false);
  });

  it("look.set 在 lookDirection 为 true 时返回 true", () => {
    const action = makeRequest({
      type: "look.set",
      payload: { x: 0.5, y: -0.3 },
    });
    const capabilities = {
      renderer: {
        motions: [] as readonly string[],
        expressions: [] as readonly string[],
        lookDirection: true,
        outfits: [] as readonly string[],
      },
    };
    expect(isActionSupported(action, capabilities)).toBe(true);
  });

  it("look.set 在 lookDirection 为 false 时返回 false", () => {
    const action = makeRequest({
      type: "look.set",
      payload: { x: 0.5, y: -0.3 },
    });
    const capabilities = {
      renderer: {
        motions: [] as readonly string[],
        expressions: [] as readonly string[],
        lookDirection: false,
        outfits: [] as readonly string[],
      },
    };
    expect(isActionSupported(action, capabilities)).toBe(false);
  });

  it("window.move 在 window 能力可用时返回 true", () => {
    const action = makeRequest({
      type: "window.move",
      payload: { target: { kind: "semantic", position: "center" } },
    });
    expect(isActionSupported(action, { window: true })).toBe(true);
  });

  it("window.move 在 window 能力不可用时返回 false", () => {
    const action = makeRequest({
      type: "window.move",
      payload: { target: { kind: "semantic", position: "center" } },
    });
    expect(isActionSupported(action, {})).toBe(false);
  });

  it("speech.say 在 speech 能力可用时返回 true", () => {
    const action = makeRequest({
      type: "speech.say",
      payload: { text: "hello" },
    });
    expect(isActionSupported(action, { speech: true })).toBe(true);
  });

  it("timer.start 在 timer 能力可用时返回 true", () => {
    const action = makeRequest({
      type: "timer.start",
      payload: { durationMs: 5000 },
    });
    expect(isActionSupported(action, { timer: true })).toBe(true);
  });

  it("timer.start 在 timer 能力不可用时返回 false", () => {
    const action = makeRequest({
      type: "timer.start",
      payload: { durationMs: 5000 },
    });
    expect(isActionSupported(action, {})).toBe(false);
  });

  it("wait 始终返回 true", () => {
    const action = makeRequest({
      type: "wait",
      payload: { durationMs: 1000 },
    });
    expect(isActionSupported(action, {})).toBe(true);
  });

  it("outfit.equip 在渲染器支持该服装时返回 true", () => {
    const action = makeRequest({
      type: "outfit.equip",
      payload: { outfitId: "dress-red" },
    });
    const capabilities = {
      renderer: {
        motions: [] as readonly string[],
        expressions: [] as readonly string[],
        lookDirection: false,
        outfits: ["dress-red", "suit-blue"] as readonly string[],
      },
    };
    expect(isActionSupported(action, capabilities)).toBe(true);
  });
});
