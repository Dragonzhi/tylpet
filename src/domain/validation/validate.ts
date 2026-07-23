import type {
  ActionRequest,
  ActionErrorCode,
  ActionSource,
  ActionType,
} from "../actions/types";
import { PROTOCOL_VERSION } from "../actions/types";
import type { CapabilitySet } from "../capabilities/capabilities";
import { isActionSupported } from "../capabilities/capabilities";

export type ValidationSuccess = { ok: true; action: ActionRequest };
export type ValidationFailure = {
  ok: false;
  errorCode: ActionErrorCode;
  reason: string;
};
export type ValidationResult = ValidationSuccess | ValidationFailure;

const VALID_ACTION_TYPES: readonly string[] = [
  "motion.play",
  "expression.set",
  "look.set",
  "window.move",
  "outfit.equip",
  "speech.say",
  "memory.propose",
  "timer.start",
  "timer.pause",
  "timer.resume",
  "timer.cancel",
  "media.react",
  "wait",
];

const VALID_SOURCES: readonly string[] = [
  "user",
  "agent",
  "timer",
  "system",
  "dev",
];

const VALID_SEMANTIC_POSITIONS: readonly string[] = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fail(
  errorCode: ActionErrorCode,
  reason: string,
): ValidationFailure {
  return { ok: false, errorCode, reason };
}

function validateEnvelope(
  input: Record<string, unknown>,
): ValidationResult | null {
  // --- id ---
  if (typeof input.id !== "string" || input.id.length === 0 || input.id.length > 128) {
    return fail("invalid_payload", "id 必须是非空字符串且不超过 128 字符");
  }

  // --- type ---
  if (typeof input.type !== "string") {
    return fail("invalid_payload", "type 必须是字符串");
  }
  if (!(VALID_ACTION_TYPES as readonly string[]).includes(input.type)) {
    return fail("invalid_payload", `未知动作类型: ${input.type}`);
  }

  // --- source ---
  if (typeof input.source !== "string" || !(VALID_SOURCES as readonly string[]).includes(input.source)) {
    return fail("invalid_payload", "source 不合法");
  }

  // --- requestedAt ---
  if (!isFiniteNumber(input.requestedAt) || (input.requestedAt as number) < 0) {
    return fail("invalid_payload", "requestedAt 必须是有限非负数");
  }

  // --- timeoutMs (optional) ---
  if ("timeoutMs" in input && input.timeoutMs !== undefined) {
    if (!isFiniteNumber(input.timeoutMs) || (input.timeoutMs as number) <= 0) {
      return fail("invalid_payload", "timeoutMs 必须是有限正数");
    }
  }

  // --- correlationId (optional) ---
  if ("correlationId" in input && input.correlationId !== undefined) {
    if (typeof input.correlationId !== "string" || (input.correlationId as string).length > 128) {
      return fail("invalid_payload", "correlationId 必须是字符串且不超过 128 字符");
    }
  }

  // --- payload ---
  if (input.payload === null || typeof input.payload !== "object") {
    return fail("invalid_payload", "payload 必须是对象");
  }

  return null; // no error
}

function validateMotionPlay(
  payload: Record<string, unknown>,
): ValidationResult | null {
  // motion
  if (typeof payload.motion !== "string" || payload.motion.length === 0 || payload.motion.length > 64) {
    return fail("invalid_payload", "motion 必须是非空字符串且不超过 64 字符");
  }
  // speed (optional)
  if ("speed" in payload && payload.speed !== undefined) {
    if (!isFiniteNumber(payload.speed) || (payload.speed as number) <= 0 || (payload.speed as number) > 10) {
      return fail("invalid_payload", "speed 必须是有限正数且不超过 10");
    }
  }
  return null;
}

function validateExpressionSet(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (typeof payload.expression !== "string" || payload.expression.length === 0 || payload.expression.length > 64) {
    return fail("invalid_payload", "expression 必须是非空字符串且不超过 64 字符");
  }
  if ("durationMs" in payload && payload.durationMs !== undefined) {
    if (!isFiniteNumber(payload.durationMs) || (payload.durationMs as number) < 0) {
      return fail("invalid_payload", "durationMs 必须是有限非负数");
    }
  }
  return null;
}

function validateLookSet(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (!isFiniteNumber(payload.x) || (payload.x as number) < -1 || (payload.x as number) > 1) {
    return fail("invalid_payload", "x 必须在 [-1, 1] 范围内");
  }
  if (!isFiniteNumber(payload.y) || (payload.y as number) < -1 || (payload.y as number) > 1) {
    return fail("invalid_payload", "y 必须在 [-1, 1] 范围内");
  }
  return null;
}

function validateWindowMove(
  payload: Record<string, unknown>,
): ValidationResult | null {
  // target
  if (payload.target === null || typeof payload.target !== "object") {
    return fail("invalid_payload", "target 必须是对象");
  }
  const target = payload.target as Record<string, unknown>;
  if (typeof target.kind !== "string") {
    return fail("invalid_payload", "target.kind 必须是字符串");
  }
  if (target.kind === "semantic") {
    if (typeof target.position !== "string" || !(VALID_SEMANTIC_POSITIONS as readonly string[]).includes(target.position)) {
      return fail("invalid_payload", "target.position 必须是合法的语义位置");
    }
  } else if (target.kind === "normalized") {
    if (!isFiniteNumber(target.x) || (target.x as number) < 0 || (target.x as number) > 1) {
      return fail("invalid_payload", "target.x 必须在 [0, 1] 范围内");
    }
    if (!isFiniteNumber(target.y) || (target.y as number) < 0 || (target.y as number) > 1) {
      return fail("invalid_payload", "target.y 必须在 [0, 1] 范围内");
    }
  } else {
    return fail("invalid_payload", `未知的 target.kind: ${target.kind}`);
  }

  // durationMs (optional)
  if ("durationMs" in payload && payload.durationMs !== undefined) {
    if (!isFiniteNumber(payload.durationMs) || (payload.durationMs as number) < 0 || (payload.durationMs as number) > 10000) {
      return fail("invalid_payload", "durationMs 必须在 [0, 10000] 范围内");
    }
  }
  return null;
}

function validateOutfitEquip(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (typeof payload.outfitId !== "string" || payload.outfitId.length === 0 || payload.outfitId.length > 128) {
    return fail("invalid_payload", "outfitId 必须是非空字符串且不超过 128 字符");
  }
  return null;
}

function validateSpeechSay(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (
    typeof payload.text !== "string"
    || payload.text.trim().length === 0
    || Array.from(payload.text).length > 500
  ) {
    return fail("invalid_payload", "text 必须是非空字符串且不超过 500 字符");
  }
  if ("interrupt" in payload && payload.interrupt !== undefined) {
    if (typeof payload.interrupt !== "boolean") {
      return fail("invalid_payload", "interrupt 必须是布尔值");
    }
  }
  return null;
}

function validateTimerStart(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (!isFiniteNumber(payload.durationMs) || (payload.durationMs as number) <= 0 || (payload.durationMs as number) > 86400000) {
    return fail("invalid_payload", "durationMs 必须是有限正数且不超过 86400000");
  }
  if ("label" in payload && payload.label !== undefined) {
    if (typeof payload.label !== "string" || (payload.label as string).length > 64) {
      return fail("invalid_payload", "label 必须是字符串且不超过 64 字符");
    }
  }
  if (
    "kind" in payload &&
    payload.kind !== undefined &&
    payload.kind !== "focus" &&
    payload.kind !== "break" &&
    payload.kind !== "custom"
  ) {
    return fail("invalid_payload", "kind 必须是 focus、break 或 custom");
  }
  return null;
}

function validateMemoryPropose(payload: Record<string, unknown>): ValidationResult | null {
  if (payload.category !== "preference" && payload.category !== "profile" && payload.category !== "note") {
    return fail("invalid_payload", "category 必须是 preference、profile 或 note");
  }
  if (
    typeof payload.content !== "string"
    || payload.content.trim().length === 0
    || Array.from(payload.content).length > 300
  ) {
    return fail("invalid_payload", "content 必须是非空字符串且不超过 300 字符");
  }
  if (
    typeof payload.reason !== "string"
    || payload.reason.trim().length === 0
    || Array.from(payload.reason).length > 160
  ) {
    return fail("invalid_payload", "reason 必须是非空字符串且不超过 160 字符");
  }
  return null;
}

function validateTimerPause(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (typeof payload.timerId !== "string" || payload.timerId.length === 0 || payload.timerId.length > 128) {
    return fail("invalid_payload", "timerId 必须是非空字符串且不超过 128 字符");
  }
  return null;
}

function validateTimerCancel(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (typeof payload.timerId !== "string" || payload.timerId.length === 0 || payload.timerId.length > 128) {
    return fail("invalid_payload", "timerId 必须是非空字符串且不超过 128 字符");
  }
  return null;
}

function validateWait(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (!isFiniteNumber(payload.durationMs) || (payload.durationMs as number) < 0 || (payload.durationMs as number) > 60000) {
    return fail("invalid_payload", "durationMs 必须是有限数且在 [0, 60000] 范围内");
  }
  return null;
}

function validateMediaReact(
  payload: Record<string, unknown>,
): ValidationResult | null {
  if (
    payload.state !== "playing" &&
    payload.state !== "paused" &&
    payload.state !== "stopped"
  ) {
    return fail("invalid_payload", "state 必须是 playing、paused 或 stopped");
  }
  return null;
}

function applyDefaults(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  const result = { ...payload };
  if (type === "motion.play" && !("speed" in result)) {
    result.speed = 1;
  }
  if (type === "speech.say" && !("interrupt" in result)) {
    result.interrupt = true;
  }
  if (type === "window.move" && !("durationMs" in result)) {
    result.durationMs = 1000;
  }
  return result;
}

export function validateActionRequest(
  input: unknown,
  options?: { capabilities?: CapabilitySet },
): ValidationResult {
  // 1. Top-level structure
  if (input === null || typeof input !== "object") {
    return fail("invalid_payload", "输入必须是对象");
  }

  const obj = input as Record<string, unknown>;

  // protocolVersion
  if (
    !("protocolVersion" in obj) ||
    !isFiniteNumber(obj.protocolVersion) ||
    (obj.protocolVersion as number) !== PROTOCOL_VERSION
  ) {
    const versionStr = "protocolVersion" in obj ? String(obj.protocolVersion) : "missing";
    return fail("invalid_payload", `不支持的协议版本: ${versionStr}`);
  }

  // 2. Envelope validation
  const envelopeError = validateEnvelope(obj);
  if (envelopeError !== null) {
    return envelopeError;
  }

  // 3. Per-payload validation
  const payload = obj.payload as Record<string, unknown>;
  const type = obj.type as string;

  let payloadError: ValidationResult | null = null;
  switch (type) {
    case "motion.play":
      payloadError = validateMotionPlay(payload);
      break;
    case "expression.set":
      payloadError = validateExpressionSet(payload);
      break;
    case "look.set":
      payloadError = validateLookSet(payload);
      break;
    case "window.move":
      payloadError = validateWindowMove(payload);
      break;
    case "outfit.equip":
      payloadError = validateOutfitEquip(payload);
      break;
    case "speech.say":
      payloadError = validateSpeechSay(payload);
      break;
    case "memory.propose":
      payloadError = validateMemoryPropose(payload);
      break;
    case "timer.start":
      payloadError = validateTimerStart(payload);
      break;
    case "timer.pause":
    case "timer.resume":
      payloadError = validateTimerPause(payload);
      break;
    case "timer.cancel":
      payloadError = validateTimerCancel(payload);
      break;
    case "media.react":
      payloadError = validateMediaReact(payload);
      break;
    case "wait":
      payloadError = validateWait(payload);
      break;
  }

  if (payloadError !== null) {
    return payloadError;
  }

  // 4. Build ActionRequest with defaults
  const actionPayloadWithDefaults = applyDefaults(type, payload);
  const action = {
    id: obj.id as string,
    type: type as ActionType,
    payload: actionPayloadWithDefaults,
    source: obj.source as ActionSource,
    requestedAt: obj.requestedAt as number,
  } as unknown as ActionRequest;

  if ("timeoutMs" in obj && obj.timeoutMs !== undefined) {
    (action as unknown as Record<string, unknown>).timeoutMs = obj.timeoutMs;
  }
  if ("correlationId" in obj && obj.correlationId !== undefined) {
    (action as unknown as Record<string, unknown>).correlationId = obj.correlationId;
  }

  // 5. Capability check (optional)
  if (options?.capabilities !== undefined) {
    if (!isActionSupported(action, options.capabilities)) {
      return fail("unsupported_action", "当前能力集不支持该动作");
    }
  }

  return { ok: true, action };
}
