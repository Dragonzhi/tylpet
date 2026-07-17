/**
 * P0 插值纯函数模块。
 * 不依赖 React、DOM 或 svgcanvas。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface TransformValue {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

export interface MotionKeyframe {
  frame: number;
  values: Partial<TransformValue>;
  easing?: "linear" | "easeInOut";
}

// ---------------------------------------------------------------------------
// 基础数学
// ---------------------------------------------------------------------------

/** 线性插值：t=0 -> a, t=1 -> b */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * smoothstep 缓动函数。
 * t < 0.5 ? 2t² : 1 - (-2t+2)² / 2
 * 端点导数为零，全程单调。
 */
export function easeInOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** 将 v 钳制在 [min, max] 内 */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

// ---------------------------------------------------------------------------
// 关键帧插值
// ---------------------------------------------------------------------------

const DEFAULT_TRANSFORM: TransformValue = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
};

const ALL_FIELDS: (keyof TransformValue)[] = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "opacity",
];

/**
 * 根据帧号对 MotionKeyframe[] 进行插值，返回完整的 TransformValue。
 *
 * - keyframes 不必有序；函数内部按 frame 升序排列。
 * - 当 frame 在首关键帧之前：返回首关键帧值（缺失字段取默认值）。
 * - 当 frame 在末关键帧之后：返回末关键帧值（缺失字段取默认值）。
 * - 中间帧：在前后的关键帧之间 lerp，并使用 prev 指定的 easing。
 * - 缺失字段使用 DEFAULT_TRANSFORM 补全。
 */
export function interpolateKeyframes(
  keyframes: MotionKeyframe[],
  frame: number,
): TransformValue {
  if (keyframes.length === 0) {
    return { ...DEFAULT_TRANSFORM };
  }

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // 在首关键帧之前
  if (frame <= sorted[0].frame) {
    return { ...DEFAULT_TRANSFORM, ...sorted[0].values };
  }

  // 在末关键帧之后
  if (frame >= sorted[sorted.length - 1].frame) {
    return { ...DEFAULT_TRANSFORM, ...sorted[sorted.length - 1].values };
  }

  // 在中间
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    if (frame < prev.frame || frame > next.frame) continue;

    const tRaw =
      next.frame === prev.frame
        ? 1
        : (frame - prev.frame) / (next.frame - prev.frame);
    const clamped = clamp(tRaw, 0, 1);
    const t =
      prev.easing === "easeInOut" ? easeInOut(clamped) : clamped;

    const result: TransformValue = { ...DEFAULT_TRANSFORM };
    for (const field of ALL_FIELDS) {
      const a = prev.values[field] ?? DEFAULT_TRANSFORM[field];
      const b = next.values[field] ?? DEFAULT_TRANSFORM[field];
      result[field] = lerp(a, b, t);
    }
    return result;
  }

  return { ...DEFAULT_TRANSFORM };
}
