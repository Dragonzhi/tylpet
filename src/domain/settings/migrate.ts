import type { PetSettings } from "./types";
import { CURRENT_SCHEMA_VERSION } from "./types";
import { createDefaultSettings } from "./defaults";

/**
 * 将旧版本设置迁移到当前版本。
 *
 * 当前只有 version 1，此函数为未来版本升级预留。
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
    },
  };
}
