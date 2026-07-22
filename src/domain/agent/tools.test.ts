import { describe, expect, it } from "vitest";
import type { ProviderToolCall } from "../chat/types";
import type { AgentCapabilitySnapshot } from "./types";
import { createAgentToolDefinitions, mapToolCallToAction } from "./tools";

const SNAPSHOT: AgentCapabilitySnapshot = {
  protocolVersion: 1,
  capturedAt: 10,
  capabilities: {
    renderer: {
      motions: ["bow", "stretch", "wave"],
      expressions: ["normal", "blink", "speak", "sleep"],
      lookDirection: true,
      outfits: [],
    },
    window: true,
    timer: true,
    speech: false,
  },
};

function call(name: string, args: unknown): ProviderToolCall {
  return { id: "call-1", type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function mappingOptions() {
  return {
    actionId: "a1",
    requestedAt: 10,
    correlationId: "c1",
    capabilities: SNAPSHOT.capabilities,
  };
}

describe("M12 agent tools", () => {
  it("exports only the capability-backed semantic whitelist", () => {
    const definitions = createAgentToolDefinitions(SNAPSHOT);
    expect(definitions.map((tool) => tool.function.name)).toEqual([
      "pet_play_motion", "pet_set_expression", "pet_set_look", "pet_move_window",
      "timer_start", "timer_pause", "timer_resume", "timer_cancel",
    ]);
    expect(JSON.stringify(definitions)).not.toMatch(/shell|javascript|tauri|selector/i);
  });

  it("publishes exact runtime motion and expression enums with semantic hints", () => {
    const definitions = createAgentToolDefinitions(SNAPSHOT);
    expect(definitions.find((tool) => tool.function.name === "pet_play_motion")).toMatchObject({
      function: {
        description: expect.stringContaining("wave（招手）"),
        parameters: { properties: { motion: { enum: ["bow", "stretch", "wave"] } } },
      },
    });
    expect(definitions.find((tool) => tool.function.name === "pet_set_expression")).toMatchObject({
      function: {
        description: expect.stringContaining("blink（眨眼）"),
        parameters: { properties: { expression: { enum: ["normal", "blink", "speak", "sleep"] } } },
      },
    });
  });

  it("omits tools whose runtime capability is unavailable", () => {
    const definitions = createAgentToolDefinitions({
      ...SNAPSHOT,
      capabilities: {
        ...SNAPSHOT.capabilities,
        renderer: { motions: [], expressions: [], lookDirection: false, outfits: [] },
        timer: false,
      },
    });
    expect(definitions.map((tool) => tool.function.name)).toEqual(["pet_move_window"]);
  });

  it("maps a tool call into a validated agent ActionRequest", () => {
    const result = mapToolCallToAction(
      call("pet_move_window", { position: "right", durationMs: 500 }),
      mappingOptions(),
    );
    expect(result).toMatchObject({
      ok: true,
      action: { id: "a1", type: "window.move", source: "agent", correlationId: "c1" },
    });
  });

  it("returns actionable allowed values when a model invents an enum value", () => {
    expect(mapToolCallToAction(call("pet_play_motion", { motion: "dance" }), mappingOptions())).toMatchObject({
      ok: false,
      errorCode: "unsupported_action",
      reason: expect.stringContaining("bow、stretch、wave"),
    });
    expect(mapToolCallToAction(call("pet_set_expression", { expression: "happy" }), mappingOptions())).toMatchObject({
      ok: false,
      errorCode: "unsupported_action",
      reason: expect.stringContaining("normal、blink、speak、sleep"),
    });
  });

  it("explains misspelled argument fields instead of returning a generic missing-value error", () => {
    expect(mapToolCallToAction(call("pet_set_expression", { username: "normal" }), mappingOptions())).toMatchObject({
      ok: false,
      errorCode: "invalid_payload",
      reason: expect.stringMatching(/username.*expression/u),
    });
  });

  it("rejects unknown tools and invalid arguments without interpreting text", () => {
    expect(mapToolCallToAction(call("run_shell", { command: "calc" }), mappingOptions()))
      .toMatchObject({ ok: false, errorCode: "unsupported_action" });
    expect(mapToolCallToAction(call("pet_set_look", { x: 99, y: 0 }), mappingOptions()))
      .toMatchObject({ ok: false, errorCode: "invalid_payload" });
  });
});
