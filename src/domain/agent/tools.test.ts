import { describe, expect, it } from "vitest";
import type { ProviderToolCall } from "../chat/types";
import { AGENT_TOOL_DEFINITIONS, mapToolCallToAction } from "./tools";

function call(name: string, args: unknown): ProviderToolCall {
  return { id: "call-1", type: "function", function: { name, arguments: JSON.stringify(args) } };
}

describe("M12 agent tools", () => {
  it("exports only the versioned semantic whitelist", () => {
    expect(AGENT_TOOL_DEFINITIONS.map((tool) => tool.function.name)).toEqual([
      "pet_play_motion", "pet_set_expression", "pet_set_look", "pet_move_window",
      "timer_start", "timer_pause", "timer_resume", "timer_cancel",
    ]);
    expect(JSON.stringify(AGENT_TOOL_DEFINITIONS)).not.toMatch(/shell|javascript|tauri|selector/i);
  });

  it("maps a tool call into a validated agent ActionRequest", () => {
    const result = mapToolCallToAction(call("pet_move_window", { position: "right", durationMs: 500 }), {
      actionId: "a1", requestedAt: 10, correlationId: "c1",
    });
    expect(result).toMatchObject({
      ok: true,
      action: { id: "a1", type: "window.move", source: "agent", correlationId: "c1" },
    });
  });

  it("rejects unknown tools and invalid arguments without interpreting text", () => {
    expect(mapToolCallToAction(call("run_shell", { command: "calc" }), {
      actionId: "a", requestedAt: 0, correlationId: "c",
    })).toMatchObject({ ok: false, errorCode: "unsupported_action" });
    expect(mapToolCallToAction(call("pet_set_look", { x: 99, y: 0 }), {
      actionId: "a", requestedAt: 0, correlationId: "c",
    })).toMatchObject({ ok: false, errorCode: "invalid_payload" });
  });
});
