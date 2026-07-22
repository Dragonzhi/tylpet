import { PROTOCOL_VERSION, type ActionErrorCode, type ActionRequest, type ActionType } from "../actions/types";
import type { ProviderToolCall, ProviderToolDefinition } from "../chat/types";
import { validateActionRequest } from "../validation/validate";
import { AGENT_TOOL_PROTOCOL_VERSION, type AgentToolName } from "./types";

const noExtraProperties = { additionalProperties: false } as const;

/** OpenAI-compatible function tools. Only these names can become local actions. */
export const AGENT_TOOL_DEFINITIONS: ProviderToolDefinition[] = [
  defineTool("pet_play_motion", "播放一个已安装的角色命名动作，例如 wave。", {
    type: "object",
    properties: {
      motion: { type: "string", minLength: 1, maxLength: 64 },
      speed: { type: "number", exclusiveMinimum: 0, maximum: 2 },
    },
    required: ["motion"],
    ...noExtraProperties,
  }),
  defineTool("pet_set_expression", "短暂设置角色表情。", {
    type: "object",
    properties: {
      expression: { type: "string", minLength: 1, maxLength: 64 },
      durationMs: { type: "integer", minimum: 0, maximum: 10_000 },
    },
    required: ["expression"],
    ...noExtraProperties,
  }),
  defineTool("pet_set_look", "让角色看向归一化方向；x/y 均为 -1 到 1。", {
    type: "object",
    properties: {
      x: { type: "number", minimum: -1, maximum: 1 },
      y: { type: "number", minimum: -1, maximum: 1 },
    },
    required: ["x", "y"],
    ...noExtraProperties,
  }),
  defineTool("pet_move_window", "把桌宠移动到当前屏幕的语义位置；执行前需要用户确认。", {
    type: "object",
    properties: {
      position: {
        type: "string",
        enum: ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
      },
      durationMs: { type: "integer", minimum: 0, maximum: 10_000 },
    },
    required: ["position"],
    ...noExtraProperties,
  }),
  defineTool("timer_start", "启动一个本地可靠计时器。", {
    type: "object",
    properties: {
      durationMinutes: { type: "number", minimum: 1 / 60, maximum: 1_440 },
      label: { type: "string", maxLength: 64 },
      kind: { type: "string", enum: ["focus", "break", "custom"] },
    },
    required: ["durationMinutes"],
    ...noExtraProperties,
  }),
  ...(["pause", "resume", "cancel"] as const).map((operation) =>
    defineTool(`timer_${operation}`, `${operation === "cancel" ? "取消（执行前需要用户确认）" : operation === "pause" ? "暂停" : "继续"}指定计时器。`, {
      type: "object",
      properties: { timerId: { type: "string", minLength: 1, maxLength: 128 } },
      required: ["timerId"],
      ...noExtraProperties,
    })
  ),
];

export interface ToolMappingSuccess {
  ok: true;
  action: ActionRequest;
}

export interface ToolMappingFailure {
  ok: false;
  reason: string;
  errorCode: ActionErrorCode;
}

export function mapToolCallToAction(
  call: ProviderToolCall,
  options: { actionId: string; requestedAt: number; correlationId: string },
): ToolMappingSuccess | ToolMappingFailure {
  if (!isAgentToolName(call.function.name)) {
    return { ok: false, errorCode: "unsupported_action", reason: `未知工具：${call.function.name}` };
  }
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    args = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, errorCode: "invalid_payload", reason: "工具参数不是合法 JSON 对象" };
  }

  const mapped = mapArguments(call.function.name, args);
  if (!mapped) {
    return { ok: false, errorCode: "invalid_payload", reason: "工具参数无法映射为语义动作" };
  }
  const raw = {
    protocolVersion: PROTOCOL_VERSION,
    id: options.actionId,
    type: mapped.type,
    payload: mapped.payload,
    source: "agent",
    requestedAt: options.requestedAt,
    timeoutMs: 30_000,
    correlationId: options.correlationId,
  };
  const validation = validateActionRequest(raw);
  return validation.ok
    ? { ok: true, action: validation.action }
    : { ok: false, errorCode: validation.errorCode, reason: validation.reason };
}

export function actionRequiresConfirmation(type: ActionType): boolean {
  return type === "window.move" || type === "timer.cancel";
}

export function describeActionForConfirmation(action: ActionRequest): string {
  if (action.type === "window.move") {
    const target = action.payload.target;
    return target.kind === "semantic"
      ? `允许小洛宝移动到当前屏幕的“${target.position}”位置吗？`
      : "允许小洛宝移动窗口吗？";
  }
  if (action.type === "timer.cancel") {
    return `允许取消计时器“${action.payload.timerId}”吗？`;
  }
  return "允许执行这个动作吗？";
}

export function isAgentToolName(value: string): value is AgentToolName {
  return AGENT_TOOL_DEFINITIONS.some((tool) => tool.function.name === value);
}

function defineTool(
  name: AgentToolName,
  description: string,
  parameters: Record<string, unknown>,
): ProviderToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: `[ltypet-agent-tools/v${AGENT_TOOL_PROTOCOL_VERSION}] ${description}`,
      parameters,
    },
  };
}

function mapArguments(
  name: AgentToolName,
  args: Record<string, unknown>,
): { type: ActionType; payload: Record<string, unknown> } | null {
  switch (name) {
    case "pet_play_motion":
      return { type: "motion.play", payload: pick(args, ["motion", "speed"]) };
    case "pet_set_expression":
      return { type: "expression.set", payload: pick(args, ["expression", "durationMs"]) };
    case "pet_set_look":
      return { type: "look.set", payload: pick(args, ["x", "y"]) };
    case "pet_move_window":
      return {
        type: "window.move",
        payload: {
          target: { kind: "semantic", position: args.position },
          ...(args.durationMs === undefined ? {} : { durationMs: args.durationMs }),
        },
      };
    case "timer_start":
      return {
        type: "timer.start",
        payload: {
          durationMs: typeof args.durationMinutes === "number" ? Math.round(args.durationMinutes * 60_000) : args.durationMinutes,
          ...(args.label === undefined ? {} : { label: args.label }),
          ...(args.kind === undefined ? {} : { kind: args.kind }),
        },
      };
    case "timer_pause":
      return { type: "timer.pause", payload: pick(args, ["timerId"]) };
    case "timer_resume":
      return { type: "timer.resume", payload: pick(args, ["timerId"]) };
    case "timer_cancel":
      return { type: "timer.cancel", payload: pick(args, ["timerId"]) };
  }
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
}
