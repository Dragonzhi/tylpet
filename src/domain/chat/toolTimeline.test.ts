import { describe, expect, it } from "vitest";
import type { AgentToolExecution } from "../agent/types";
import { insertBeforeItem, summarizeToolOnlyTurn, toolDisplayName } from "./toolTimeline";

function execution(name: string, status: "completed" | "rejected", reason?: string): AgentToolExecution {
  return {
    toolCall: { id: `call-${name}`, type: "function", function: { name, arguments: "{}" } },
    result: { actionId: `action-${name}`, status, reason, finishedAt: 1 },
  };
}

describe("tool timeline", () => {
  it("uses user-facing names for known tools", () => {
    expect(toolDisplayName("memory_propose")).toBe("保存长期记忆");
    expect(toolDisplayName("future_tool")).toBe("执行工具");
  });

  it("provides a deterministic reply for successful tool-only turns", () => {
    expect(summarizeToolOnlyTurn([execution("pet_play_motion", "completed")]))
      .toBe("播放角色动作已完成。");
  });

  it("surfaces failures and never returns an empty fallback", () => {
    expect(summarizeToolOnlyTurn([execution("memory_propose", "rejected", "用户拒绝")]))
      .toContain("用户拒绝");
    expect(summarizeToolOnlyTurn([])).toBe("（模型没有返回文本内容）");
  });

  it("inserts tool events immediately before the active assistant placeholder", () => {
    expect(insertBeforeItem(
      [{ id: "user" }, { id: "assistant" }],
      "assistant",
      { id: "tool" },
    ).map((item) => item.id)).toEqual(["user", "tool", "assistant"]);
  });
});
