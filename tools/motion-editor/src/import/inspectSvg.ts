/**
 * SVG 语义部件检测。
 * 从 inkscape:label 发现语义部件，读取 pivot 标记坐标。
 */

import type { Diagnostic, ImportedPartRef } from "../svgcanvas/SvgCanvasAdapter";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface PivotPosition {
  x: number;
  y: number;
  sourceElementId: string;
}

export interface InspectResult {
  parts: ImportedPartRef[];
  pivotLabels: Set<string>;
  /** partId → { x, y, sourceElementId } */
  pivotMap: Map<string, PivotPosition>;
  diags: Diagnostic[];
}

// ---------------------------------------------------------------------------
// 容器 label（不作为语义部件）
// ---------------------------------------------------------------------------

const CONTAINER_LABELS = new Set(["character", "hair_accessory"]);

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 检查 SVG 文本，提取语义部件列表和 pivot 标记信息。
 *
 * - 语义部件通过 inkscape:label 识别，排除容器 label 和 pivot_* 前缀。
 * - 记录重复 label、缺少 DOM id。
 * - 读取 pivot_* 标记的 cx/cy 坐标。
 */
export function inspectParts(svgText: string): InspectResult {
  const diags: Diagnostic[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    diags.push({
      severity: "error",
      message: `XML 解析错误: ${parseError.textContent?.slice(0, 200) ?? ""}`,
    });
    return { parts: [], pivotLabels: new Set(), pivotMap: new Map(), diags };
  }

  const svgRoot = doc.documentElement;
  if (!svgRoot || svgRoot.tagName.toLowerCase() !== "svg") {
    diags.push({ severity: "error", message: "根元素不是 <svg>" });
    return { parts: [], pivotLabels: new Set(), pivotMap: new Map(), diags };
  }

  // 程序化遍历所有元素，使用 getAttribute 兼容不同 DOM 实现
  const allElements = svgRoot.querySelectorAll("*");
  const parts: ImportedPartRef[] = [];
  const pivotLabels = new Set<string>();
  const pivotMap = new Map<string, PivotPosition>();
  const seenLabels = new Map<string, number>();

  for (const el of allElements) {
    const label = el.getAttribute("inkscape:label");
    if (!label) continue;

    // pivot 标记
    if (label.startsWith("pivot_")) {
      const partId = label.replace(/^pivot_/, "");
      pivotLabels.add(partId);

      const cx = parseFloat(el.getAttribute("cx") ?? "NaN");
      const cy = parseFloat(el.getAttribute("cy") ?? "NaN");
      const sourceElementId = el.getAttribute("id") ?? "";
      pivotMap.set(partId, {
        x: Number.isFinite(cx) ? cx : 0,
        y: Number.isFinite(cy) ? cy : 0,
        sourceElementId,
      });
      continue;
    }

    // 跳过容器 label
    if (CONTAINER_LABELS.has(label)) continue;

    // 语义部件
    const existing = seenLabels.get(label) ?? 0;
    seenLabels.set(label, existing + 1);

    if (existing > 0) {
      diags.push({
        severity: "warn",
        message: `重复 label: "${label}" 出现 ${existing + 1} 次`,
      });
    }

    const domId = el.getAttribute("id") ?? "";
    if (!domId) {
      diags.push({
        severity: "warn",
        message: `部件 "${label}" 缺少 DOM id`,
      });
    }

    parts.push({
      partId: label,
      inkscapeLabel: label,
      sourceElementId: domId,
      element: null as unknown as SVGElement,
    });
  }

  // 检测孤立 pivot（pivot 存在但无对应部件）
  pivotLabels.forEach((p) => {
    if (!seenLabels.has(p)) {
      diags.push({
        severity: "warn",
        message: `孤立 pivot: pivot_${p} 存在但无对应部件 "${p}"`,
      });
    }
  });

  // 检测缺少 pivot 的部件
  parts.forEach((p) => {
    if (!pivotLabels.has(p.partId)) {
      diags.push({
        severity: "info",
        message: `部件 "${p.partId}" 缺少 pivot 标记`,
      });
    }
  });

  return { parts, pivotLabels, pivotMap, diags };
}
