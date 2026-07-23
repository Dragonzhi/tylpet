/**
 * 用户设置结构定义。
 *
 * schemaVersion 用于版本迁移：当结构变化时递增版本号，
 * migrate() 函数负责将旧版本数据升级到当前版本。
 *
 * 所有坐标为物理像素，与 Tauri 窗口 API 一致。
 */

/** 当前设置结构版本号 */
export const CURRENT_SCHEMA_VERSION = 9 as const;

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
  /** M11 对话使用的模型供应商；Agent 工具能力仍由 enabled 单独控制。 */
  provider: "mock" | "openai-compatible";
  /** OpenAI-compatible Chat Completions 完整地址。 */
  endpoint: string;
  /** 供应商模型标识。 */
  model: string;
  /** 单次外发上下文的 Unicode 字符预算，范围 [1000, 100000]。 */
  maxContextChars: number;
  /** 原生网络请求超时，范围 [3000, 120000] 毫秒。 */
  timeoutMs: number;
  /** 首个增量前的自动重试次数，范围 [0, 2]。 */
  maxRetries: number;
  /** 用户是否明确同意把对话文本发送给外部 Provider。 */
  externalDataConsent: boolean;
  /** 临时测试用：是否明确允许向 HTTP 接口明文发送密钥和对话。 */
  allowInsecureHttp: boolean;
}

/** M14 本地系统语音与朗读偏好。 */
export interface SpeechSettings {
  /** 是否允许 speech.say 和回复朗读。 */
  enabled: boolean;
  /** 对话完成后是否自动朗读最终回复。 */
  autoReadReplies: boolean;
  /** 系统语音速率，范围 [0.5, 2]。 */
  rate: number;
  /** 系统语音音高，范围 [0.5, 2]。 */
  pitch: number;
  /** Web Speech voiceURI；空字符串表示系统默认。 */
  voiceUri: string;
}

/** 番茄钟时长与完成提醒偏好。 */
export interface PomodoroSettings {
  /** 默认专注时长（分钟），范围 [1, 180]。 */
  focusMinutes: number;
  /** 默认休息时长（分钟），范围 [1, 180]。 */
  breakMinutes: number;
  /** 计时完成时请求系统级注意提醒。 */
  showSystemReminder: boolean;
  /** 计时完成时播放系统提示音。 */
  soundEnabled: boolean;
}

/** M13 外部观察事件和主动反馈偏好。 */
export interface ObservationSettings {
  /** 所有系统观察和创作者插件反馈的总开关，默认关闭。 */
  enabled: boolean;
  /** Windows 系统音乐状态观察开关；M13-B 由媒体适配器消费。 */
  systemMediaEnabled: boolean;
  /** 系统音乐视觉反应强度，范围 [0, 1]。 */
  musicReactionIntensity: number;
  /** 是否在内存中保留不含 payload 的有限诊断记录。 */
  diagnosticsEnabled: boolean;
  /** 是否在每日本地时间范围内拒绝外部反馈。 */
  quietHoursEnabled: boolean;
  /** 安静时段开始，距本地午夜分钟数，范围 [0, 1439]。 */
  quietHoursStartMinute: number;
  /** 安静时段结束，距本地午夜分钟数，范围 [0, 1439]。 */
  quietHoursEndMinute: number;
}

/** M15 长期记忆和羁绊开关；数据本身保存在独立 memory.v1.json。 */
export type MemoryProposalMode = "off" | "confirm" | "explicit-auto";

export interface MemorySettings {
  /** 无记忆模式总开关；关闭时既不读取上下文，也不累计羁绊。 */
  enabled: boolean;
  /** 是否把用户明确保存的记忆摘要加入模型上下文。 */
  includeInModelContext: boolean;
  /** 是否按固定规则记录成功对话并增加羁绊。 */
  bondEnabled: boolean;
  /** 模型提出候选记忆时的确认策略。 */
  proposalMode: MemoryProposalMode;
}

/** 完整的用户设置 */
export interface PetSettings {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  window: WindowSettings;
  animation: AnimationSettings;
  audio: AudioSettings;
  speech: SpeechSettings;
  agent: AgentSettings;
  pomodoro: PomodoroSettings;
  observation: ObservationSettings;
  memory: MemorySettings;
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
