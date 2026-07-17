/**
 * P0 实验性动作模块。
 * 包含实验 clip 类型定义和默认动作数据。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/**
 * P0 实验 clip：简化的关键帧动作描述。
 * 后续阶段会演进为更通用的时间轴模型。
 */
export interface ExperimentalClip {
  id: string;
  partId: string;
  fps: number;
  durationFrames: number;
  pivot: { x: number; y: number };
  keyframes: { frame: number; rotation: number; easing: string }[];
}

// ---------------------------------------------------------------------------
// 默认实验 clip：p0-wave
// ---------------------------------------------------------------------------

/**
 * 默认实验动作：右手波浪挥手。
 * - partId: arm_right
 * - fps: 24
 * - 24 帧共 1 秒
 * - 第 0 帧 rotation=0°, 第 12 帧 rotation=-55°, 第 24 帧 rotation=0°
 * - 全部 easeInOut 缓动
 * - pivot 默认 {0,0}，之后从素材 pivot 标记读取
 */
export const DEFAULT_EXPERIMENTAL_CLIP: ExperimentalClip = {
  id: "p0-wave",
  partId: "arm_right",
  fps: 24,
  durationFrames: 24,
  pivot: { x: 0, y: 0 },
  keyframes: [
    { frame: 0, rotation: 0, easing: "easeInOut" },
    { frame: 12, rotation: -55, easing: "easeInOut" },
    { frame: 24, rotation: 0, easing: "easeInOut" },
  ],
};
