/**
 * P0 实验性项目序列化模块。
 * 纯函数，不依赖 React、DOM 或 svgcanvas。
 */

import type { ExperimentalClip } from "../motion/experimentalMotion";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ExperimentalProject {
  experimentalSchema: "m8-p0@1";
  productionReady: false;
  sourceFingerprint: string;
  clip: ExperimentalClip;
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

export function serializeProject(p: ExperimentalProject): string {
  return JSON.stringify(p, null, 2);
}

// ---------------------------------------------------------------------------
// 反序列化与校验
// ---------------------------------------------------------------------------

/**
 * 解析并校验实验项目 JSON。
 *
 * @throws Error 描述具体的校验失败原因
 */
export function parseProject(json: string): ExperimentalProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("无效的 JSON 格式");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("JSON 根值必须是对象");
  }

  const p = parsed as Record<string, unknown>;

  // --- schema ---
  if (p.experimentalSchema !== "m8-p0@1") {
    throw new Error('experimentalSchema 必须是 "m8-p0@1"');
  }

  // --- productionReady ---
  if (p.productionReady !== false) {
    throw new Error("productionReady 必须为 false");
  }

  // --- sourceFingerprint ---
  if (typeof p.sourceFingerprint !== "string" || p.sourceFingerprint === "") {
    throw new Error("sourceFingerprint 必须是有效的非空字符串");
  }

  // --- clip ---
  if (typeof p.clip !== "object" || p.clip === null) {
    throw new Error("clip 必须是对象");
  }

  const clip = p.clip as Record<string, unknown>;

  // id
  if (typeof clip.id !== "string" || clip.id === "") {
    throw new Error("clip.id 必须是有效的非空字符串");
  }

  // partId
  if (typeof clip.partId !== "string" || clip.partId === "") {
    throw new Error("clip.partId 必须是有效的非空字符串");
  }

  // fps
  const fps = Number(clip.fps);
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw new Error("fps 必须在 1-60 范围内且为整数");
  }

  // durationFrames
  const durationFrames = Number(clip.durationFrames);
  if (!Number.isInteger(durationFrames) || durationFrames < 0) {
    throw new Error("durationFrames 必须是非负整数");
  }

  // pivot
  if (typeof clip.pivot !== "object" || clip.pivot === null) {
    throw new Error("clip.pivot 必须是对象");
  }
  const pivot = clip.pivot as Record<string, unknown>;
  const px = Number(pivot.x);
  const py = Number(pivot.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    throw new Error("pivot 坐标必须是有限数值");
  }

  // keyframes
  if (!Array.isArray(clip.keyframes) || clip.keyframes.length === 0) {
    throw new Error("keyframes 必须是包含至少一个关键帧的数组");
  }

  const seenFrames = new Set<number>();

  for (const kf of clip.keyframes) {
    if (typeof kf !== "object" || kf === null) {
      throw new Error("每个关键帧必须是对象");
    }
    const kfObj = kf as Record<string, unknown>;

    const frame = Number(kfObj.frame);
    if (
      !Number.isInteger(frame) ||
      frame < 0 ||
      frame > durationFrames ||
      !Number.isFinite(frame)
    ) {
      throw new Error(
        `关键帧 frame ${kfObj.frame} 无效：必须在 0-${durationFrames} 范围内`,
      );
    }
    if (seenFrames.has(frame)) {
      throw new Error(`重复的关键帧 frame: ${frame}`);
    }
    seenFrames.add(frame);

    const rotation = Number(kfObj.rotation);
    if (!Number.isFinite(rotation)) {
      throw new Error(`关键帧 ${frame} 的 rotation 必须是有限数值`);
    }

    const easing = kfObj.easing;
    if (easing !== "linear" && easing !== "easeInOut") {
      throw new Error(
        `关键帧 ${frame} 的 easing 无效：必须是 "linear" 或 "easeInOut"`,
      );
    }
  }

  // 全面 NaN/Infinity 检查（递归扫描所有数值字段）
  scanForNonFinite(parsed, "");

  return parsed as ExperimentalProject;
}

/**
 * 深度扫描所有数值字段，遇到 NaN/Infinity 时抛出。
 */
function scanForNonFinite(value: unknown, path: string): void {
  if (value === null || value === undefined) return;

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${path || "根"} 包含 NaN 或 Infinity`);
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForNonFinite(item, `${path}[${i}]`));
  } else if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      scanForNonFinite(
        (value as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      );
    }
  }
}
