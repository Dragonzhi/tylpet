import type { PetSettings } from "./types";
import { CURRENT_SCHEMA_VERSION } from "./types";

/**
 * 默认设置。
 *
 * 窗口位置使用 NaN 表示"尚未保存过位置"，
 * 恢复时由调用方决定回退策略（居中或上次位置）。
 */
export function createDefaultSettings(): PetSettings {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    window: {
      x: Number.NaN,
      y: Number.NaN,
      alwaysOnTop: true,
      clickThrough: true,
    },
    animation: {
      intensity: 1,
    },
    audio: {
      enabled: true,
      volume: 0.8,
    },
    agent: {
      enabled: false,
      provider: "mock",
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "",
      maxContextChars: 24_000,
      timeoutMs: 45_000,
      maxRetries: 1,
      externalDataConsent: false,
      allowInsecureHttp: false,
    },
    speech: {
      enabled: false,
      autoReadReplies: false,
      rate: 1,
      pitch: 1,
      voiceUri: "",
    },
    pomodoro: {
      focusMinutes: 25,
      breakMinutes: 5,
      showSystemReminder: true,
      soundEnabled: true,
    },
    observation: {
      enabled: false,
      systemMediaEnabled: false,
      musicReactionIntensity: 0.55,
      diagnosticsEnabled: true,
      quietHoursEnabled: false,
      quietHoursStartMinute: 22 * 60,
      quietHoursEndMinute: 8 * 60,
    },
    memory: {
      enabled: false,
      includeInModelContext: false,
      bondEnabled: false,
      proposalMode: "confirm",
    },
  };
}
