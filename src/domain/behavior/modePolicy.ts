import type { BehaviorMode, PetSettings } from "../settings/types";

export interface BehaviorModePolicy {
  mode: BehaviorMode;
  label: string;
  summary: string;
  allowAutonomy: boolean;
  allowAgent: boolean;
  allowSpeech: boolean;
  allowObservations: boolean;
  observationCooldownMultiplier: number;
  observationIntensityMultiplier: number;
  animationIntensityMultiplier: number;
  blinkIntervalMultiplier: number;
  sleeping: boolean;
}

const POLICIES: Record<BehaviorMode, BehaviorModePolicy> = {
  companion: {
    mode: "companion",
    label: "陪伴",
    summary: "正常陪伴；按你的总开关允许 Agent、朗读和低频外部反馈。",
    allowAutonomy: true,
    allowAgent: true,
    allowSpeech: true,
    allowObservations: true,
    observationCooldownMultiplier: 1,
    observationIntensityMultiplier: 1,
    animationIntensityMultiplier: 1,
    blinkIntervalMultiplier: 1,
    sleeping: false,
  },
  focus: {
    mode: "focus",
    label: "专注",
    summary: "保留对话和番茄钟，降低聊天外反馈强度并延长冷却。",
    allowAutonomy: true,
    allowAgent: true,
    allowSpeech: true,
    allowObservations: true,
    observationCooldownMultiplier: 3,
    observationIntensityMultiplier: 0.35,
    animationIntensityMultiplier: 0.72,
    blinkIntervalMultiplier: 1.4,
    sleeping: false,
  },
  quiet: {
    mode: "quiet",
    label: "安静",
    summary: "暂停 Agent、语音朗读和外部反馈，只保留轻量基础动画与手动操作。",
    allowAutonomy: false,
    allowAgent: false,
    allowSpeech: false,
    allowObservations: false,
    observationCooldownMultiplier: 1,
    observationIntensityMultiplier: 0,
    animationIntensityMultiplier: 0.5,
    blinkIntervalMultiplier: 1.8,
    sleeping: false,
  },
  sleep: {
    mode: "sleep",
    label: "休眠",
    summary: "进入低频休眠姿态；仍可拖动、打开菜单、使用托盘和立即停止。",
    allowAutonomy: false,
    allowAgent: false,
    allowSpeech: false,
    allowObservations: false,
    observationCooldownMultiplier: 1,
    observationIntensityMultiplier: 0,
    animationIntensityMultiplier: 0.25,
    blinkIntervalMultiplier: 3,
    sleeping: true,
  },
};

export function getBehaviorModePolicy(mode: BehaviorMode): BehaviorModePolicy {
  return POLICIES[mode];
}

export interface EffectiveBehaviorCapabilities {
  companion: boolean;
  agent: boolean;
  speech: boolean;
  observations: boolean;
  timer: true;
}

export function getEffectiveBehaviorCapabilities(
  settings: PetSettings,
): EffectiveBehaviorCapabilities {
  const policy = getBehaviorModePolicy(settings.behavior.mode);
  return {
    companion: settings.companion.autonomyEnabled && policy.allowAutonomy,
    agent: settings.agent.enabled && policy.allowAgent,
    speech: settings.audio.enabled
      && settings.audio.volume > 0
      && settings.speech.enabled
      && policy.allowSpeech,
    observations: settings.observation.enabled && policy.allowObservations,
    timer: true,
  };
}

export const BEHAVIOR_MODE_POLICIES = Object.values(POLICIES);
