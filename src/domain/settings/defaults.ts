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
    },
  };
}
