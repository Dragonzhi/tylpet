import type { PetSettings, SettingsValidationResult } from "./types";
import { CURRENT_SCHEMA_VERSION } from "./types";
import { migrate } from "./migrate";

/**
 * 校验并解析未知输入为 PetSettings。
 *
 * 处理流程：
 * 1. 尝试 JSON.parse（如果输入是字符串）
 * 2. 检查基本结构
 * 3. 迁移到当前版本
 * 4. 校验字段范围
 *
 * 损坏的输入不会抛出异常，而是返回错误结果，
 * 调用方可以回退到默认设置。
 */
export function parseSettings(input: unknown): SettingsValidationResult {
  // 如果输入是字符串，尝试 JSON.parse
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return {
        ok: false,
        code: "invalid_json",
        reason: "设置文件不是合法的 JSON",
      };
    }
  }

  // null 或非对象
  if (parsed === null || typeof parsed !== "object") {
    return {
      ok: false,
      code: "invalid_structure",
      reason: "设置必须是对象",
    };
  }

  const obj = parsed as Record<string, unknown>;

  // 检查 schemaVersion 是否存在且是数字
  if ("schemaVersion" in obj) {
    if (typeof obj.schemaVersion !== "number" || !Number.isFinite(obj.schemaVersion)) {
      return {
        ok: false,
        code: "invalid_structure",
        reason: "schemaVersion 必须是有限数字",
      };
    }
  }

  // 迁移到当前版本
  const settings = migrate(parsed);

  // 校验字段范围
  const rangeError = validateRanges(settings);
  if (rangeError !== null) {
    return { ok: false, code: "invalid_structure", reason: rangeError };
  }

  return { ok: true, settings };
}

/**
 * 校验设置值的范围约束。
 * 返回错误描述字符串，或 null 表示通过。
 */
function validateRanges(settings: PetSettings): string | null {
  // animation.intensity: [0, 1]
  if (settings.animation.intensity < 0 || settings.animation.intensity > 1) {
    return "animation.intensity 必须在 [0, 1] 范围内";
  }

  // audio.volume: [0, 1]
  if (settings.audio.volume < 0 || settings.audio.volume > 1) {
    return "audio.volume 必须在 [0, 1] 范围内";
  }

  // window.x/y 可以是 NaN（未保存过位置）或有限数字
  if (!Number.isNaN(settings.window.x) && !Number.isFinite(settings.window.x)) {
    return "window.x 必须是有限数字或 NaN";
  }
  if (!Number.isNaN(settings.window.y) && !Number.isFinite(settings.window.y)) {
    return "window.y 必须是有限数字或 NaN";
  }

  return null;
}

/**
 * 将 PetSettings 序列化为 JSON 字符串。
 */
export function serializeSettings(settings: PetSettings): string {
  return JSON.stringify(settings, null, 2);
}

/**
 * 检查窗口位置是否已保存（非 NaN）。
 */
export function hasSavedPosition(settings: PetSettings): boolean {
  return (
    !Number.isNaN(settings.window.x) && !Number.isNaN(settings.window.y)
  );
}

// Re-export CURRENT_SCHEMA_VERSION for convenience
export { CURRENT_SCHEMA_VERSION };
