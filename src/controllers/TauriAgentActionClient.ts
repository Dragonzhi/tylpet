import { emitTo, listen } from "@tauri-apps/api/event";
import type { ActionRequest, ActionResult } from "../domain/actions/types";
import type { AgentDispatchResponse } from "../domain/agent/types";

const RESPONSE_EVENT = "agent-action-result";
const REQUEST_EVENT = "agent-action-request";
const CANCEL_EVENT = "agent-action-cancel";

export class TauriAgentActionClient {
  constructor(private readonly timeoutMs = 35_000) {}

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

function interrupted(actionId: string): ActionResult {
  return { actionId, status: "interrupted", reason: "Agent turn 已取消", finishedAt: Date.now() };
}
