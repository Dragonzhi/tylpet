import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: undefined as ((event: { payload: unknown }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, callback: (event: { payload: unknown }) => void) => {
    mocks.listener = callback;
    return Promise.resolve(mocks.unlisten);
  }),
}));

import { TauriOpenAICompatibleProvider } from "./TauriOpenAICompatibleProvider";

describe("TauriOpenAICompatibleProvider", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.unlisten.mockReset();
    mocks.listener = undefined;
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("forwards native deltas and completes", async () => {
    const provider = new TauriOpenAICompatibleProvider({
      endpoint: "https://example.com/v1/chat/completions",
      model: "test-model",
      timeoutMs: 30_000,
      maxRetries: 1,
      allowInsecureHttp: false,
    });
    const chunks: string[] = [];
    const promise = provider.stream(
      { requestId: "r1", messages: [{ role: "user", content: "hello" }] },
      { signal: new AbortController().signal, onDelta: (chunk) => chunks.push(chunk) },
    );
    await vi.waitFor(() => expect(mocks.listener).toBeDefined());
    mocks.listener?.({ payload: { requestId: "other", eventType: "delta", delta: "x" } });
    mocks.listener?.({ payload: { requestId: "r1", eventType: "delta", delta: "你" } });
    mocks.listener?.({
      payload: {
        requestId: "r1",
        eventType: "done",
        toolCalls: [{ id: "c1", type: "function", function: { name: "pet_play_motion", arguments: "{}" } }],
      },
    });
    await expect(promise).resolves.toEqual({
      toolCalls: [{ id: "c1", type: "function", function: { name: "pet_play_motion", arguments: "{}" } }],
    });
    expect(chunks).toEqual(["你"]);
    expect(mocks.invoke).toHaveBeenCalledWith("chat_start", {
      request: expect.objectContaining({ allowInsecureHttp: false, tools: undefined }),
    });
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("cancels the native request", async () => {
    const provider = new TauriOpenAICompatibleProvider({
      endpoint: "https://example.com/chat",
      model: "model",
      timeoutMs: 30_000,
      maxRetries: 0,
      allowInsecureHttp: false,
    });
    const controller = new AbortController();
    const promise = provider.stream(
      { requestId: "r2", messages: [{ role: "user", content: "hello" }] },
      { signal: controller.signal, onDelta: () => undefined },
    );
    await vi.waitFor(() => expect(mocks.listener).toBeDefined());
    controller.abort();
    mocks.listener?.({
      payload: {
        requestId: "r2",
        eventType: "error",
        error: { code: "cancelled", message: "已停止生成", retryable: false },
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
    expect(mocks.invoke).toHaveBeenCalledWith("chat_cancel", { requestId: "r2" });
  });

  it.each([
    ["network_error", true],
    ["rate_limited", true],
    ["invalid_api_key", false],
  ] as const)("preserves structured %s errors", async (code, retryable) => {
    const provider = new TauriOpenAICompatibleProvider({
      endpoint: "https://example.com/chat",
      model: "model",
      timeoutMs: 30_000,
      maxRetries: 0,
      allowInsecureHttp: false,
    });
    const promise = provider.stream(
      { requestId: `error-${code}`, messages: [{ role: "user", content: "hello" }] },
      { signal: new AbortController().signal, onDelta: () => undefined },
    );
    await vi.waitFor(() => expect(mocks.listener).toBeDefined());
    mocks.listener?.({
      payload: {
        requestId: `error-${code}`,
        eventType: "error",
        error: { code, message: `error ${code}`, retryable },
      },
    });
    await expect(promise).rejects.toMatchObject({ code, retryable });
  });
});
