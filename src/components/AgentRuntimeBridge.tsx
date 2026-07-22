import { useEffect, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { AGENT_LIMITS } from "../config/agent";
import type { ActionRequest, ActionResult } from "../domain/actions/types";
import {
  AGENT_TOOL_PROTOCOL_VERSION,
  type AgentCapabilityRequest,
  type AgentCapabilitySnapshot,
  type AgentDispatchRequest,
} from "../domain/agent/types";
import { AgentActionPolicy } from "../domain/agent/policy";
import { PROTOCOL_VERSION } from "../domain/actions/types";
import type { RendererCapabilities } from "../domain/capabilities/capabilities";
import { validateActionRequest } from "../domain/validation/validate";
import { getDefaultChannel } from "../domain/scheduler/channelPolicy";
import type { SchedulerEvent } from "../domain/scheduler/types";
import { usePetRuntime } from "../hooks/usePetRuntime";

const ALLOWED_ACTIONS = new Set<ActionRequest["type"]>([
  "motion.play",
  "expression.set",
  "look.set",
  "window.move",
  "timer.start",
  "timer.pause",
  "timer.resume",
  "timer.cancel",
]);

export default function AgentRuntimeBridge({ enabled }: { enabled: boolean }) {
  const runtime = usePetRuntime();
  const enabledRef = useRef(enabled);
  const capabilitiesRef = useRef(runtime.capabilities);
  const policyRef = useRef(new AgentActionPolicy(AGENT_LIMITS));
  const requestsRef = useRef(new Map<string, string>());

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      for (const actionId of requestsRef.current.values()) runtime.scheduler.cancel(actionId);
      requestsRef.current.clear();
    }
  }, [enabled, runtime.scheduler]);

  useEffect(() => {
    capabilitiesRef.current = runtime.capabilities;
    void emitTo("chat", "agent-capabilities-changed", createCapabilitySnapshot(runtime.capabilities))
      .catch(() => undefined);
  }, [runtime.capabilities]);

  useEffect(() => {
    let active = true;
    const cleanups: Array<() => void> = [];
    const install = async () => {
      cleanups.push(await listen<AgentCapabilityRequest>("agent-capabilities-request", (event) => {
        void emitTo("chat", "agent-capabilities-result", {
          requestId: event.payload.requestId,
          snapshot: createCapabilitySnapshot(capabilitiesRef.current),
        }).catch(() => undefined);
      }));
      cleanups.push(await listen<AgentDispatchRequest>("agent-action-request", (event) => {
        void handleRequest(event.payload);
      }));
      cleanups.push(await listen<{ requestId: string }>("agent-action-cancel", (event) => {
        const actionId = requestsRef.current.get(event.payload.requestId);
        if (actionId) runtime.scheduler.cancel(actionId);
      }));
      cleanups.push(await listen("agent-stop-all", () => {
        runtime.scheduler.cancelAll();
        requestsRef.current.clear();
      }));
      if (!active) cleanups.splice(0).forEach((cleanup) => cleanup());
    };

    const handleRequest = async (request: AgentDispatchRequest) => {
      let result: ActionResult;
      try {
        result = await validateAuthorizeAndRun(request);
      } catch (error) {
        result = rejected(
          actionIdFromUnknown(request.action),
          "internal_error",
          `主窗口执行 Agent 动作失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      requestsRef.current.delete(request.requestId);
      await emitTo("chat", "agent-action-result", {
        requestId: request.requestId,
        result,
      }).catch(() => undefined);
    };

    const validateAuthorizeAndRun = async (request: AgentDispatchRequest): Promise<ActionResult> => {
      const raw = request.action && typeof request.action === "object"
        ? { ...(request.action as Record<string, unknown>), protocolVersion: PROTOCOL_VERSION, source: "agent" }
        : request.action;
      const validation = validateActionRequest(raw, {
        capabilities: {
          renderer: capabilitiesRef.current,
          window: true,
          timer: true,
          speech: false,
        },
      });
      if (!validation.ok) {
        return rejected(actionIdFromUnknown(request.action), validation.errorCode, validation.reason);
      }
      if (!ALLOWED_ACTIONS.has(validation.action.type)) {
        return rejected(validation.action.id, "permission_denied", "该动作不在 M12 Agent 白名单中");
      }
      const decision = policyRef.current.authorize(validation.action, {
        enabled: enabledRef.current,
        confirmed: request.confirmed === true,
      });
      if (!decision.allowed) {
        return rejected(validation.action.id, decision.errorCode ?? "permission_denied", decision.reason ?? "动作被本地策略拒绝");
      }
      const channel = getDefaultChannel(validation.action.type);
      if (!channel) return rejected(validation.action.id, "unsupported_action", "动作没有可用调度通道");
      requestsRef.current.set(request.requestId, validation.action.id);
      return submitAndWait(validation.action, channel);
    };

    const submitAndWait = (action: ActionRequest, channel: NonNullable<ReturnType<typeof getDefaultChannel>>): Promise<ActionResult> =>
      new Promise((resolve) => {
        const unsubscribe = runtime.scheduler.onEvent((event) => {
          if (event.actionId !== action.id || !isTerminal(event)) return;
          unsubscribe();
          resolve(resultFromEvent(event));
        });
        runtime.scheduler.submit(action, {
          channel,
          priority: "agent",
          cooldownMs: AGENT_LIMITS.cooldownMs[action.type],
        });
      });

    void install().catch((error: unknown) => console.error("安装 Agent 运行时桥接失败：", error));
    return () => {
      active = false;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      for (const actionId of requestsRef.current.values()) runtime.scheduler.cancel(actionId);
      requestsRef.current.clear();
    };
  }, [runtime.scheduler]);

  return null;
}

function createCapabilitySnapshot(renderer: RendererCapabilities): AgentCapabilitySnapshot {
  return {
    protocolVersion: AGENT_TOOL_PROTOCOL_VERSION,
    capturedAt: Date.now(),
    capabilities: {
      renderer: {
        motions: [...renderer.motions],
        expressions: [...renderer.expressions],
        lookDirection: renderer.lookDirection,
        outfits: [...renderer.outfits],
      },
      window: true,
      timer: true,
      speech: false,
    },
  };
}

function isTerminal(event: SchedulerEvent): boolean {
  return ["completed", "interrupted", "rejected", "timed_out", "failed", "cancelled", "cooldown_rejected"].includes(event.type);
}

function resultFromEvent(event: SchedulerEvent): ActionResult {
  const status = event.type === "cancelled" || event.type === "cooldown_rejected"
    ? "rejected"
    : event.type;
  return {
    actionId: event.actionId,
    status,
    finishedAt: event.timestamp,
    reason: event.reason ?? (event.type === "cooldown_rejected" ? "动作仍在调度器冷却中" : undefined),
    errorCode: event.errorCode ?? (event.type === "cooldown_rejected" ? "cooldown_active" : undefined),
  } as ActionResult;
}

function rejected(actionId: string, errorCode: string, reason: string): ActionResult {
  return { actionId, status: "rejected", errorCode, reason, finishedAt: Date.now() };
}

function actionIdFromUnknown(action: unknown): string {
  if (action && typeof action === "object" && typeof (action as Record<string, unknown>).id === "string") {
    return (action as Record<string, unknown>).id as string;
  }
  return "invalid-agent-action";
}
