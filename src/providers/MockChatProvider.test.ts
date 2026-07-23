import { describe, expect, it, vi } from "vitest";
import { MockChatProvider } from "./MockChatProvider";

describe("MockChatProvider", () => {
  it("streams deterministic offline chunks", async () => {
    vi.useFakeTimers();
    const provider = new MockChatProvider({ chunkDelayMs: 10 });
    const chunks: string[] = [];
    const promise = provider.stream(
      { requestId: "r1", messages: [{ role: "user", content: "你好" }] },
      { signal: new AbortController().signal, onDelta: (chunk) => chunks.push(chunk) },
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(chunks.join("")).toBe("（离线 Mock）我收到了：你好");
    vi.useRealTimers();
  });

  it("supports cancellation", async () => {
    vi.useFakeTimers();
    const provider = new MockChatProvider({ chunkDelayMs: 10 });
    const controller = new AbortController();
    const promise = provider.stream(
      { requestId: "r1", messages: [{ role: "user", content: "你好" }] },
      { signal: controller.signal, onDelta: () => undefined },
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
    vi.useRealTimers();
  });

  it("acts as a deterministic fake model when tools are provided", async () => {
    const provider = new MockChatProvider({ chunkDelayMs: 0 });
    const response = await provider.stream(
      {
        requestId: "agent-1",
        messages: [{ role: "user", content: "请向我招手" }],
        tools: [{
          type: "function",
          function: {
            name: "pet_play_motion",
            description: "",
            parameters: { properties: { motion: { type: "string", enum: ["wave"] } } },
          },
        }],
      },
      { signal: new AbortController().signal, onDelta: () => undefined },
    );
    expect(response.toolCalls).toEqual([
      expect.objectContaining({ function: expect.objectContaining({ name: "pet_play_motion" }) }),
    ]);
  });

  it("does not fake an action that is absent from the runtime tool schema", async () => {
    const provider = new MockChatProvider({ chunkDelayMs: 0 });
    const response = await provider.stream(
      {
        requestId: "agent-2",
        messages: [{ role: "user", content: "请向我招手" }],
        tools: [{ type: "function", function: { name: "pet_move_window", description: "", parameters: {} } }],
      },
      { signal: new AbortController().signal, onDelta: () => undefined },
    );
    expect(response.toolCalls).toEqual([]);
  });

  it("proposes explicit memories only when the memory tool is exposed", async () => {
    const provider = new MockChatProvider({ chunkDelayMs: 0 });
    const response = await provider.stream(
      {
        requestId: "agent-memory",
        messages: [{ role: "user", content: "请记住我不喜欢香菜" }],
        tools: [{
          type: "function",
          function: { name: "memory_propose", description: "", parameters: {} },
        }],
      },
      { signal: new AbortController().signal, onDelta: () => undefined },
    );
    expect(response.toolCalls[0]?.function).toMatchObject({
      name: "memory_propose",
      arguments: expect.stringContaining("我不喜欢香菜"),
    });
  });
});
