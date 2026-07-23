import {
  ChatProviderError,
  type ChatProvider,
  type ChatProviderResponse,
  type ChatProviderRequest,
  type ChatStreamOptions,
  type ProviderToolCall,
} from "../domain/chat/types";

export interface MockChatProviderOptions {
  chunkDelayMs?: number;
}

export class MockChatProvider implements ChatProvider {
  readonly id = "mock" as const;
  readonly external = false;
  private readonly chunkDelayMs: number;

  constructor(options: MockChatProviderOptions = {}) {
    this.chunkDelayMs = options.chunkDelayMs ?? 35;
  }

  async stream(
    request: ChatProviderRequest,
    options: ChatStreamOptions,
  ): Promise<ChatProviderResponse> {
    const prompt = [...request.messages].reverse().find((message) =>
      message.role === "user"
    )?.content.trim();
    if (!prompt) {
      throw new ChatProviderError("invalid_request", "请输入想说的话");
    }
    const lastMessage = request.messages[request.messages.length - 1];
    if (request.tools && lastMessage?.role === "tool") {
      await streamText("好呀，动作已经处理完成。", this.chunkDelayMs, options);
      return { toolCalls: [] };
    }
    const toolCall = request.tools ? createDeterministicToolCall(prompt, request.tools) : null;
    if (toolCall) return { toolCalls: [toolCall] };

    const response = `（离线 Mock）我收到了：${prompt}`;
    await streamText(response, this.chunkDelayMs, options);
    return { toolCalls: [] };
  }
}

async function streamText(
  response: string,
  chunkDelayMs: number,
  options: ChatStreamOptions,
): Promise<void> {
    for (const chunk of splitText(response, 4)) {
      if (options.signal.aborted) {
        throw new ChatProviderError("cancelled", "已停止生成");
      }
      await abortableDelay(chunkDelayMs, options.signal);
      options.onDelta(chunk);
    }
}

function createDeterministicToolCall(
  prompt: string,
  tools: NonNullable<ChatProviderRequest["tools"]>,
): ProviderToolCall | null {
  const explicitMemory = extractExplicitMemory(prompt);
  if (explicitMemory && hasTool(tools, "memory_propose")) {
    const category = /(喜欢|不喜欢|偏好|爱吃|常用)/u.test(explicitMemory)
      ? "preference"
      : /(我叫|我是|住在|生日|职业)/u.test(explicitMemory)
        ? "profile"
        : "note";
    return toolCall("mock-memory", "memory_propose", {
      category,
      content: Array.from(explicitMemory).slice(0, 300).join(""),
      reason: "用户明确要求在后续对话中记住这项信息",
    });
  }
  if (/(招手|挥手)/u.test(prompt) && toolAllowsEnumValue(tools, "pet_play_motion", "motion", "wave")) {
    return toolCall("mock-wave", "pet_play_motion", { motion: "wave", speed: 1 });
  }
  if (/(右边|右侧)/u.test(prompt) && /(移动|过去|去)/u.test(prompt) && hasTool(tools, "pet_move_window")) {
    return toolCall("mock-move", "pet_move_window", { position: "right", durationMs: 800 });
  }
  const minutes = prompt.match(/(\d+)\s*分钟/u)?.[1];
  if (minutes && /(计时|专注|番茄)/u.test(prompt) && hasTool(tools, "timer_start")) {
    return toolCall("mock-timer", "timer_start", {
      durationMinutes: Number(minutes),
      label: "小洛宝计时",
      kind: "focus",
    });
  }
  return null;
}

function extractExplicitMemory(prompt: string): string | null {
  const match = prompt.match(/(?:请|帮我)?(?:记住|记一下|以后要记得)[:：，,\s]*(.+)/u);
  const content = match?.[1]?.trim();
  return content || null;
}

function hasTool(tools: NonNullable<ChatProviderRequest["tools"]>, name: string): boolean {
  return tools.some((tool) => tool.function.name === name);
}

function toolAllowsEnumValue(
  tools: NonNullable<ChatProviderRequest["tools"]>,
  name: string,
  parameter: string,
  value: string,
): boolean {
  const tool = tools.find((candidate) => candidate.function.name === name);
  const properties = tool?.function.parameters.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  const schema = (properties as Record<string, unknown>)[parameter];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const values = (schema as Record<string, unknown>).enum;
  return Array.isArray(values) && values.includes(value);
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ProviderToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function splitText(text: string, size: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += size) {
    chunks.push(chars.slice(index, index + size).join(""));
  }
  return chunks;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChatProviderError("cancelled", "已停止生成"));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new ChatProviderError("cancelled", "已停止生成"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
