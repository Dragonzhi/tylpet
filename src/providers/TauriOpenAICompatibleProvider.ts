import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ChatProviderError,
  type ChatErrorCode,
  type ChatProvider,
  type ChatProviderResponse,
  type ChatProviderRequest,
  type ChatStreamOptions,
  type ProviderToolCall,
} from "../domain/chat/types";

interface ProviderOptions {
  endpoint: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  allowInsecureHttp: boolean;
}

interface NativeChatError {
  code?: string;
  message?: string;
  retryable?: boolean;
}

interface NativeChatEvent {
  requestId: string;
  eventType: "delta" | "done" | "error";
  delta?: string;
  toolCalls?: ProviderToolCall[];
  error?: NativeChatError;
}

export class TauriOpenAICompatibleProvider implements ChatProvider {
  readonly id = "openai-compatible" as const;
  readonly external = true;

  constructor(private readonly config: ProviderOptions) {}

  async stream(
    request: ChatProviderRequest,
    options: ChatStreamOptions,
  ): Promise<ChatProviderResponse> {
    if (options.signal.aborted) {
      throw new ChatProviderError("cancelled", "已停止生成");
    }
    let settle: ((response: ChatProviderResponse) => void) | undefined;
    let fail: ((error: ChatProviderError) => void) | undefined;
    const completion = new Promise<ChatProviderResponse>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const unlisten = await listen<NativeChatEvent>("chat-stream", (event) => {
      if (event.payload.requestId !== request.requestId) return;
      if (event.payload.eventType === "delta" && event.payload.delta) {
        options.onDelta(event.payload.delta);
      } else if (event.payload.eventType === "done") {
        settle?.({ toolCalls: event.payload.toolCalls ?? [] });
      } else if (event.payload.eventType === "error") {
        fail?.(toProviderError(event.payload.error));
      }
    });
    const onAbort = () => {
      void invoke("chat_cancel", { requestId: request.requestId });
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (options.signal.aborted) {
        throw new ChatProviderError("cancelled", "已停止生成");
      }
      await invoke("chat_start", {
        request: {
          requestId: request.requestId,
          endpoint: this.config.endpoint,
          model: this.config.model,
          messages: request.messages,
          tools: request.tools,
          timeoutMs: this.config.timeoutMs,
          maxRetries: this.config.maxRetries,
          allowInsecureHttp: this.config.allowInsecureHttp,
        },
      });
      if (options.signal.aborted) {
        await invoke("chat_cancel", { requestId: request.requestId });
      }
      return await completion;
    } catch (error) {
      throw toProviderError(error);
    } finally {
      options.signal.removeEventListener("abort", onAbort);
      unlisten();
    }
  }
}

function toProviderError(error: unknown): ChatProviderError {
  if (error instanceof ChatProviderError) return error;
  const native = error && typeof error === "object"
    ? error as NativeChatError
    : undefined;
  const code = isChatErrorCode(native?.code) ? native.code : "internal_error";
  return new ChatProviderError(
    code,
    native?.message ?? (typeof error === "string" ? error : "模型请求失败"),
    native?.retryable ?? false,
  );
}

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === "string" && [
    "cancelled",
    "invalid_configuration",
    "invalid_request",
    "missing_api_key",
    "invalid_api_key",
    "network_error",
    "timeout",
    "rate_limited",
    "provider_unavailable",
    "provider_error",
    "invalid_response",
    "secret_store_error",
    "request_conflict",
    "internal_error",
  ].includes(value);
}
