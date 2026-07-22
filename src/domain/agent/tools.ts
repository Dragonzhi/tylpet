import { PROTOCOL_VERSION, type ActionErrorCode, type ActionRequest, type ActionType } from "../actions/types";
import type { CapabilitySet } from "../capabilities/capabilities";
import { isActionSupported } from "../capabilities/capabilities";
import type { ProviderToolCall, ProviderToolDefinition } from "../chat/types";
import { validateActionRequest } from "../validation/validate";
import {
  AGENT_TOOL_PROTOCOL_VERSION,
  type AgentCapabilitySnapshot,
  type AgentToolName,
} from "./types";

const noExtraProperties = { additionalProperties: false } as const;

interface AgentToolAdapter {
  name: AgentToolName;
  isAvailable(capabilities: CapabilitySet): boolean;
  createDefinition(snapshot: AgentCapabilitySnapshot): ProviderToolDefinition;
  validateArguments?(args: Record<string, unknown>): string | null;
  mapArguments(args: Record<string, unknown>): { type: ActionType; payload: Record<string, unknown> };
}

/**
 * Agent 工具唯一注册表。新增能力时在这里同时声明可用条件、模型 schema 和
 * M1 Action 映射；主窗口仍会独立做第二次白名单与能力校验。
 */
const AGENT_TOOL_ADAPTERS: readonly AgentToolAdapter[] = [
  {
    name: "pet_play_motion",
    isAvailable: ({ renderer }) => Boolean(renderer?.motions.length),
    createDefinition: ({ capabilities }) => {
      const motions = capabilities.renderer?.motions ?? [];
      return defineTool(
        "pet_play_motion",
        `播放一个已安装的角色动作。参数对象必须使用 motion 字段，例如 {"motion":"wave","speed":1}。motion 只能原样选择枚举值，不要翻译、留空或创造名称。可用动作：${describeValues(motions, MOTION_LABELS)}。`,
        {
          type: "object",
          properties: {
            motion: { type: "string", enum: motions },
            speed: { type: "number", exclusiveMinimum: 0, maximum: 2, default: 1 },
          },
          required: ["motion"],
          ...noExtraProperties,
        },
      );
    },
    validateArguments: (args) => validateExactArguments(args, ["motion", "speed"], ["motion"]),
    mapArguments: (args) => ({ type: "motion.play", payload: pick(args, ["motion", "speed"]) }),
  },
  {
    name: "pet_set_expression",
    isAvailable: ({ renderer }) => Boolean(renderer?.expressions.length),
    createDefinition: ({ capabilities }) => {
      const expressions = capabilities.renderer?.expressions ?? [];
      return defineTool(
        "pet_set_expression",
        `短暂设置角色表情。参数对象必须使用 expression 字段，例如 {"expression":"speak","durationMs":500}。durationMs 结束后本地会自动恢复 normal，绝对不要再调用一次来恢复。expression 只能原样选择枚举值，不要翻译或创造名称。可用表情：${describeValues(expressions, EXPRESSION_LABELS)}。`,
        {
          type: "object",
          properties: {
            expression: { type: "string", enum: expressions },
            durationMs: { type: "integer", minimum: 0, maximum: 10_000 },
          },
          required: ["expression"],
          ...noExtraProperties,
        },
      );
    },
    validateArguments: (args) => validateExactArguments(args, ["expression", "durationMs"], ["expression"]),
    mapArguments: (args) => ({ type: "expression.set", payload: pick(args, ["expression", "durationMs"]) }),
  },
  {
    name: "pet_set_look",
    isAvailable: ({ renderer }) => renderer?.lookDirection === true,
    createDefinition: () => defineTool("pet_set_look", "让角色看向归一化方向；x/y 均为 -1 到 1。", {
      type: "object",
      properties: {
        x: { type: "number", minimum: -1, maximum: 1 },
        y: { type: "number", minimum: -1, maximum: 1 },
      },
      required: ["x", "y"],
      ...noExtraProperties,
    }),
    mapArguments: (args) => ({ type: "look.set", payload: pick(args, ["x", "y"]) }),
  },
  {
    name: "pet_move_window",
    isAvailable: ({ window }) => window === true,
    createDefinition: () => defineTool("pet_move_window", "把桌宠移动到当前屏幕的语义位置；执行前需要用户确认。", {
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
    mapArguments: (args) => ({
      type: "window.move",
      payload: {
        target: { kind: "semantic", position: args.position },
        ...(args.durationMs === undefined ? {} : { durationMs: args.durationMs }),
      },
    }),
  },
  {
    name: "timer_start",
    isAvailable: ({ timer }) => timer === true,
    createDefinition: () => defineTool("timer_start", "启动一个本地可靠计时器。", {
      type: "object",
      properties: {
        durationMinutes: { type: "number", minimum: 1 / 60, maximum: 1_440 },
        label: { type: "string", maxLength: 64 },
        kind: { type: "string", enum: ["focus", "break", "custom"] },
      },
      required: ["durationMinutes"],
      ...noExtraProperties,
    }),
    mapArguments: (args) => ({
      type: "timer.start",
      payload: {
        durationMs: typeof args.durationMinutes === "number" ? Math.round(args.durationMinutes * 60_000) : args.durationMinutes,
        ...(args.label === undefined ? {} : { label: args.label }),
        ...(args.kind === undefined ? {} : { kind: args.kind }),
      },
    }),
  },
  ...(["pause", "resume", "cancel"] as const).map((operation): AgentToolAdapter => ({
    name: `timer_${operation}`,
    isAvailable: ({ timer }) => timer === true,
    createDefinition: () => defineTool(
      `timer_${operation}`,
      `${operation === "cancel" ? "取消（执行前需要用户确认）" : operation === "pause" ? "暂停" : "继续"}指定计时器。`,
      {
        type: "object",
        properties: { timerId: { type: "string", minLength: 1, maxLength: 128 } },
        required: ["timerId"],
        ...noExtraProperties,
      },
    ),
    mapArguments: (args) => ({ type: `timer.${operation}`, payload: pick(args, ["timerId"]) }),
  })),
];

const MOTION_LABELS: Readonly<Record<string, string>> = {
  wave: "招手",
  bow: "鞠躬",
  stretch: "伸懒腰",
};

const EXPRESSION_LABELS: Readonly<Record<string, string>> = {
  normal: "恢复正常",
  blink: "眨眼",
  speak: "说话口型",
  sleep: "睡眠",
};

export interface ToolMappingSuccess {
  ok: true;
  action: ActionRequest;
}

export interface ToolMappingFailure {
  ok: false;
  reason: string;
  errorCode: ActionErrorCode;
}

/** 只向模型暴露本轮真实可用的工具与枚举。 */
export function createAgentToolDefinitions(snapshot: AgentCapabilitySnapshot): ProviderToolDefinition[] {
  return AGENT_TOOL_ADAPTERS
    .filter((adapter) => adapter.isAvailable(snapshot.capabilities))
    .map((adapter) => adapter.createDefinition(snapshot));
}

/** 给 system prompt 使用的简短运行时能力说明。 */
export function describeAgentCapabilities(snapshot: AgentCapabilitySnapshot): string {
  const renderer = snapshot.capabilities.renderer;
  return [
    `动作 ID：${renderer?.motions.length ? describeValues(renderer.motions, MOTION_LABELS) : "无"}。`,
    `表情 ID：${renderer?.expressions.length ? describeValues(renderer.expressions, EXPRESSION_LABELS) : "无"}。`,
    "所有枚举参数必须逐字使用 schema 中的英文 ID；不要使用中文名、同义词或空对象。",
  ].join("\n");
}

export function mapToolCallToAction(
  call: ProviderToolCall,
  options: {
    actionId: string;
    requestedAt: number;
    correlationId: string;
    capabilities: CapabilitySet;
  },
): ToolMappingSuccess | ToolMappingFailure {
  const adapter = AGENT_TOOL_ADAPTERS.find((candidate) => candidate.name === call.function.name);
  if (!adapter) {
    return { ok: false, errorCode: "unsupported_action", reason: `未知工具：${call.function.name}` };
  }
  if (!adapter.isAvailable(options.capabilities)) {
    return { ok: false, errorCode: "unsupported_action", reason: unavailableToolReason(adapter.name, options.capabilities) };
  }

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    args = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, errorCode: "invalid_payload", reason: "工具参数不是合法 JSON 对象" };
  }

  const argumentError = adapter.validateArguments?.(args);
  if (argumentError) {
    return { ok: false, errorCode: "invalid_payload", reason: argumentError };
  }

  const mapped = adapter.mapArguments(args);
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
  if (!validation.ok) {
    return { ok: false, errorCode: validation.errorCode, reason: validation.reason };
  }
  if (!isActionSupported(validation.action, options.capabilities)) {
    return {
      ok: false,
      errorCode: "unsupported_action",
      reason: unsupportedValueReason(validation.action, options.capabilities),
    };
  }
  return { ok: true, action: validation.action };
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
  return AGENT_TOOL_ADAPTERS.some((tool) => tool.name === value);
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

function unavailableToolReason(name: AgentToolName, capabilities: CapabilitySet): string {
  if (name === "pet_play_motion") return allowedValuesReason("motion", capabilities.renderer?.motions ?? []);
  if (name === "pet_set_expression") return allowedValuesReason("expression", capabilities.renderer?.expressions ?? []);
  return `当前运行时未启用 ${name} 对应的能力；不要再次调用该工具`;
}

function unsupportedValueReason(action: ActionRequest, capabilities: CapabilitySet): string {
  if (action.type === "motion.play") return allowedValuesReason("motion", capabilities.renderer?.motions ?? []);
  if (action.type === "expression.set") return allowedValuesReason("expression", capabilities.renderer?.expressions ?? []);
  return "当前能力集不支持该动作；请改用本轮 tools 中仍然存在的工具";
}

function allowedValuesReason(parameter: "motion" | "expression", values: readonly string[]): string {
  if (values.length === 0) return `当前没有可用的 ${parameter}；不要再次调用这个工具`;
  return `当前可用 ${parameter} 仅有：${values.join("、")}；必须原样选择其中一个英文 ID，不能留空、翻译或创造名称`;
}

function describeValues(values: readonly string[], labels: Readonly<Record<string, string>>): string {
  return values.map((value) => labels[value] ? `${value}（${labels[value]}）` : value).join("、");
}

function validateExactArguments(
  args: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): string | null {
  const unexpected = Object.keys(args).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !(key in args));
  if (unexpected.length === 0 && missing.length === 0) return null;
  const expected = `{ ${required.map((key) => `"${key}": ...`).join(", ")} }`;
  if (unexpected.length > 0 && missing.length > 0) {
    return `参数字段 ${unexpected.join("、")} 无效，同时缺少 ${missing.join("、")}；必须使用 ${expected}，不要改写字段名`;
  }
  if (unexpected.length > 0) {
    return `参数字段 ${unexpected.join("、")} 无效；只允许 ${allowed.join("、")}，不要改写字段名`;
  }
  return `缺少必填字段 ${missing.join("、")}；必须使用 ${expected}`;
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
}
