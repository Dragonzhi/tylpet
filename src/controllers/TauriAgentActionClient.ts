import { emitTo, listen } from "@tauri-apps/api/event";
import type { ActionRequest, ActionResult } from "../domain/actions/types";
import type {
  AgentCapabilityResponse,
  AgentCapabilitySnapshot,
  AgentDispatchResponse,
} from "../domain/agent/types";

const RESPONSE_EVENT = "agent-action-result";
const REQUEST_EVENT = "agent-action-request";
const CANCEL_EVENT = "agent-action-cancel";
const CAPABILITY_RESPONSE_EVENT = "agent-capabilities-result";
const CAPABILITY_REQUEST_EVENT = "agent-capabilities-request";

export class TauriAgentActionClient {
  constructor(private readonly timeoutMs = 35_000) {}

  async getCapabilities(signal: AbortSignal): Promise<AgentCapabilitySnapshot> {
    if (signal.aborted) throw new Error("能力同步已取消");
    const requestId = createRequestId("capabilities");
    let unlisten: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveResponse: (snapshot: AgentCapabilitySnapshot) => void = () => undefined;
    let rejectResponse: (error: unknown) => void = () => undefined;
    const response = new Promise<AgentCapabilitySnapshot>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const onAbort = () => rejectResponse(new Error("能力同步已取消"));
    try {
      unlisten = await listen<AgentCapabilityResponse>(CAPABILITY_RESPONSE_EVENT, (event) => {
        if (event.payload.requestId === requestId) resolveResponse(event.payload.snapshot);
      });
      if (signal.aborted) throw new Error("能力同步已取消");
      signal.addEventListener("abort", onAbort, { once: true });
      timeout = globalThis.setTimeout(() => rejectResponse(new Error("等待主窗口能力同步超时")), 5_000);
      await emitTo("main", CAPABILITY_REQUEST_EVENT, { requestId });
      return await response;
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      unlisten?.();
    }
  }

  async dispatch(
    action: ActionRequest,
    confirmed: boolean,
    signal: AbortSignal,
  ): Promise<ActionResult> {
    if (signal.aborted) return interrupted(action.id);
    const requestId = `dispatch-${action.id}`;
    let unlisten: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      let resolveResponse: (result: ActionResult) => void = () => undefined;
      let rejectResponse: (error: unknown) => void = () => undefined;
      const response = new Promise<ActionResult>((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
        timeout = globalThis.setTimeout(() => {
          reject(new Error("等待主窗口执行动作超时"));
        }, this.timeoutMs);
      });
      try {
        unlisten = await listen<AgentDispatchResponse>(RESPONSE_EVENT, (event) => {
          if (event.payload.requestId === requestId) resolveResponse(event.payload.result);
        });
      } catch (error) {
        rejectResponse(error);
        return await response;
      }
      if (signal.aborted) return interrupted(action.id);
      const onAbort = () => {
        void emitTo("main", CANCEL_EVENT, { requestId }).catch(() => undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        await emitTo("main", REQUEST_EVENT, { requestId, action, confirmed });
        return await response;
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } finally {
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      unlisten?.();
    }
  }
}

function createRequestId(prefix: string): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function interrupted(actionId: string): ActionResult {
  return { actionId, status: "interrupted", reason: "Agent turn 已取消", finishedAt: Date.now() };
}
