/**
 * 用户设置结构定义。
 *
 * schemaVersion 用于版本迁移：当结构变化时递增版本号，
 * migrate() 函数负责将旧版本数据升级到当前版本。
 *
 * 所有坐标为物理像素，与 Tauri 窗口 API 一致。
 */

/** 当前设置结构版本号 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** 窗口位置与外观状态 */
export interface WindowSettings {
  /** 窗口左上角 X 坐标（物理像素） */
  x: number;
  /** 窗口左上角 Y 坐标（物理像素） */
  y: number;
  /** 是否始终置顶 */
  alwaysOnTop: boolean;
  /** 是否启用轮廓外点击穿透 */
  clickThrough: boolean;
}

/** 动画与视觉强度 */
export interface AnimationSettings {
  /** 动作强度倍率，范围 [0, 1]，1 为完整幅度 */
  intensity: number;
}

/** 音频设置 */
export interface AudioSettings {
  /** 是否启用声音 */
  enabled: boolean;
  /** 音量，范围 [0, 1] */
  volume: number;
}

/** Agent 相关设置 */
export interface AgentSettings {
  /** Agent 总开关 */
  enabled: boolean;
}

/** 完整的用户设置 */
export interface PetSettings {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  window: WindowSettings;
  animation: AnimationSettings;
  audio: AudioSettings;
  agent: AgentSettings;
}

/** 校验错误码 */
export type SettingsErrorCode =
  | "invalid_json"
  | "invalid_structure"
  | "unsupported_version";

/** 校验结果 */
export type SettingsValidationResult =
  | { ok: true; settings: PetSettings }
  | { ok: false; code: SettingsErrorCode; reason: string };
