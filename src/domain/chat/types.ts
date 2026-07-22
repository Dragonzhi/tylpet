export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export type ProviderRole = "system" | "user" | "assistant" | "tool";

export interface ProviderToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
  /** OpenAI-compatible API field names are intentionally snake_case. */
  tool_call_id?: string;
  tool_calls?: ProviderToolCall[];
}

export interface ProviderToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatProviderRequest {
  requestId: string;
  messages: ProviderMessage[];
  tools?: ProviderToolDefinition[];
}

export interface ChatStreamOptions {
  signal: AbortSignal;
  onDelta(delta: string): void;
}

export interface ChatProviderResponse {
  toolCalls: ProviderToolCall[];
}

export type ChatProviderId = "mock" | "openai-compatible";

export interface ChatProvider {
  readonly id: ChatProviderId;
  readonly external: boolean;
  stream(request: ChatProviderRequest, options: ChatStreamOptions): Promise<ChatProviderResponse>;
}

export type ChatErrorCode =
  | "cancelled"
  | "invalid_configuration"
  | "invalid_request"
  | "missing_api_key"
  | "invalid_api_key"
  | "network_error"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_error"
  | "invalid_response"
  | "secret_store_error"
  | "request_conflict"
  | "internal_error";

export class ChatProviderError extends Error {
  constructor(
    public readonly code: ChatErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ChatProviderError";
  }
}
