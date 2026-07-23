import type { PetSettings } from "./types";
import { CURRENT_SCHEMA_VERSION } from "./types";
import { createDefaultSettings } from "./defaults";

/**
 * 将旧版本设置迁移到当前版本。
 *
 * 旧版本通过与当前默认值合并升级到最新 schema。
 * 如果输入版本大于当前版本（降级场景），返回默认设置。
 */
export function migrate(raw: unknown): PetSettings {
  if (raw === null || typeof raw !== "object") {
    return createDefaultSettings();
  }

  const obj = raw as Record<string, unknown>;
  const version = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0;

  // 降级或未知版本：使用默认值
  if (version > CURRENT_SCHEMA_VERSION) {
    return createDefaultSettings();
  }

  // 从 version 0（无版本号）迁移到 1
  if (version < 1) {
    return createDefaultSettings();
  }

  // version 1 → 1：无需迁移，但需要补全缺失字段
  return mergeWithDefaults(obj);
}

/**
 * 将部分设置对象与默认值合并，确保所有字段都存在。
 * 这处理旧版本缺少某些字段的情况。
 */
function mergeWithDefaults(obj: Record<string, unknown>): PetSettings {
  const defaults = createDefaultSettings();

  const window = typeof obj.window === "object" && obj.window !== null
    ? obj.window as Record<string, unknown>
    : {};

  const animation = typeof obj.animation === "object" && obj.animation !== null
    ? obj.animation as Record<string, unknown>
    : {};

  const audio = typeof obj.audio === "object" && obj.audio !== null
    ? obj.audio as Record<string, unknown>
    : {};

  const agent = typeof obj.agent === "object" && obj.agent !== null
    ? obj.agent as Record<string, unknown>
    : {};

  const speech = typeof obj.speech === "object" && obj.speech !== null
    ? obj.speech as Record<string, unknown>
    : {};

  const pomodoro = typeof obj.pomodoro === "object" && obj.pomodoro !== null
    ? obj.pomodoro as Record<string, unknown>
    : {};

  const observation = typeof obj.observation === "object" && obj.observation !== null
    ? obj.observation as Record<string, unknown>
    : {};

  const memory = typeof obj.memory === "object" && obj.memory !== null
    ? obj.memory as Record<string, unknown>
    : {};

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    window: {
      x: typeof window.x === "number" ? window.x : defaults.window.x,
      y: typeof window.y === "number" ? window.y : defaults.window.y,
      alwaysOnTop: typeof window.alwaysOnTop === "boolean" ? window.alwaysOnTop : defaults.window.alwaysOnTop,
      clickThrough: typeof window.clickThrough === "boolean" ? window.clickThrough : defaults.window.clickThrough,
    },
    animation: {
      intensity: typeof animation.intensity === "number" ? animation.intensity : defaults.animation.intensity,
    },
    audio: {
      enabled: typeof audio.enabled === "boolean" ? audio.enabled : defaults.audio.enabled,
      volume: typeof audio.volume === "number" ? audio.volume : defaults.audio.volume,
    },
    agent: {
      enabled: typeof agent.enabled === "boolean" ? agent.enabled : defaults.agent.enabled,
      provider: agent.provider === "openai-compatible" || agent.provider === "mock"
        ? agent.provider
        : defaults.agent.provider,
      endpoint: typeof agent.endpoint === "string" ? agent.endpoint : defaults.agent.endpoint,
      model: typeof agent.model === "string" ? agent.model : defaults.agent.model,
      maxContextChars: typeof agent.maxContextChars === "number"
        ? agent.maxContextChars
        : defaults.agent.maxContextChars,
      timeoutMs: typeof agent.timeoutMs === "number" ? agent.timeoutMs : defaults.agent.timeoutMs,
      maxRetries: typeof agent.maxRetries === "number" ? agent.maxRetries : defaults.agent.maxRetries,
      externalDataConsent: typeof agent.externalDataConsent === "boolean"
        ? agent.externalDataConsent
        : defaults.agent.externalDataConsent,
      allowInsecureHttp: typeof agent.allowInsecureHttp === "boolean"
        ? agent.allowInsecureHttp
        : defaults.agent.allowInsecureHttp,
    },
    speech: {
      enabled: typeof speech.enabled === "boolean" ? speech.enabled : defaults.speech.enabled,
      autoReadReplies: typeof speech.autoReadReplies === "boolean"
        ? speech.autoReadReplies
        : defaults.speech.autoReadReplies,
      rate: typeof speech.rate === "number" ? speech.rate : defaults.speech.rate,
      pitch: typeof speech.pitch === "number" ? speech.pitch : defaults.speech.pitch,
      voiceUri: typeof speech.voiceUri === "string" ? speech.voiceUri : defaults.speech.voiceUri,
    },
    pomodoro: {
      focusMinutes: typeof pomodoro.focusMinutes === "number" ? pomodoro.focusMinutes : defaults.pomodoro.focusMinutes,
      breakMinutes: typeof pomodoro.breakMinutes === "number" ? pomodoro.breakMinutes : defaults.pomodoro.breakMinutes,
      showSystemReminder: typeof pomodoro.showSystemReminder === "boolean" ? pomodoro.showSystemReminder : defaults.pomodoro.showSystemReminder,
      soundEnabled: typeof pomodoro.soundEnabled === "boolean" ? pomodoro.soundEnabled : defaults.pomodoro.soundEnabled,
    },
    observation: {
      enabled: typeof observation.enabled === "boolean" ? observation.enabled : defaults.observation.enabled,
      systemMediaEnabled: typeof observation.systemMediaEnabled === "boolean"
        ? observation.systemMediaEnabled
        : defaults.observation.systemMediaEnabled,
      musicReactionIntensity: typeof observation.musicReactionIntensity === "number"
        ? observation.musicReactionIntensity
        : defaults.observation.musicReactionIntensity,
      diagnosticsEnabled: typeof observation.diagnosticsEnabled === "boolean"
        ? observation.diagnosticsEnabled
        : defaults.observation.diagnosticsEnabled,
      quietHoursEnabled: typeof observation.quietHoursEnabled === "boolean"
        ? observation.quietHoursEnabled
        : defaults.observation.quietHoursEnabled,
      quietHoursStartMinute: typeof observation.quietHoursStartMinute === "number"
        ? observation.quietHoursStartMinute
        : defaults.observation.quietHoursStartMinute,
      quietHoursEndMinute: typeof observation.quietHoursEndMinute === "number"
        ? observation.quietHoursEndMinute
        : defaults.observation.quietHoursEndMinute,
    },
    memory: {
      enabled: typeof memory.enabled === "boolean" ? memory.enabled : defaults.memory.enabled,
      includeInModelContext: typeof memory.includeInModelContext === "boolean"
        ? memory.includeInModelContext
        : defaults.memory.includeInModelContext,
      bondEnabled: typeof memory.bondEnabled === "boolean"
        ? memory.bondEnabled
        : defaults.memory.bondEnabled,
      proposalMode: memory.proposalMode === "off"
        || memory.proposalMode === "confirm"
        || memory.proposalMode === "explicit-auto"
        ? memory.proposalMode
        : defaults.memory.proposalMode,
    },
  };
}
