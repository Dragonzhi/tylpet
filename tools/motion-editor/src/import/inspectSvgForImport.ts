/**
 * P1-0 统一导入安全门。
 * 只一个入口 inspectSvgForImport()：零 error 才允许调用 setSvgString()。
 */

import type { SourceBinding } from "@ltypet/character-motion";

export interface Diagnostic {
  severity: "error" | "warn" | "info";
  message: string;
}

export interface PivotInfo {
  /** partId 对应的 pivot 坐标（从 SVG 标记读取的原始值） */
  x: number;
  y: number;
  sourceElementId: string;
}

export interface PartInfo {
  partId: string;
  inkscapeLabel: string;
  sourceElementId: string;
}

export interface InspectForImportResult {
  /** 零 error 时才可以载入 svgcanvas */
  hasError: boolean;
  diagnostics: Diagnostic[];
  parts: PartInfo[];
  /** partId → pivot 原始 SVG 坐标 */
  pivotMap: Map<string, PivotInfo>;
  /** 已通过安全检查的解析结果，供正式 rig binding 校验使用。 */
  root: SVGSVGElement | null;
}

/** 不作为语义部件的容器 label */
const CONTAINER_LABELS = new Set(["character", "hair_accessory"]);
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";

export function findSourceBindingMatches(
  root: SVGSVGElement,
  binding: SourceBinding,
): SVGElement[] {
  const elements = [root, ...root.querySelectorAll("*")];
  return elements.filter((element): element is SVGElement => {
    if (!(element instanceof SVGElement)) return false;
    if (binding.kind === "elementId") return element.getAttribute("id") === binding.value;
    if (binding.kind === "dataPart") return element.getAttribute("data-part") === binding.value;
    return element.getAttributeNS(INKSCAPE_NAMESPACE, "label") === binding.value;
  });
}

/**
 * 统一导入安全门。
 *
 * 步骤：
 * 1. XML 解析
 * 2. 完整遍历所有 on* 属性（不依赖 querySelector 的 CSS 选择器）
 * 3. 拒绝 script / foreignObject
 * 4. href/xlink:href 只允许同文档 #id 引用
 * 5. 检查 CSS url(...)：只允许 url(#id)
 * 6. 检查重复/缺失 ID、重复 label、孤立 pivot
 * 7. 发现 Part 和 pivot 信息
 *
 * 只有 hasError === false 时才能调用 setSvgString()。
 */
export function inspectSvgForImport(svgText: string): InspectForImportResult {
  const diags: Diagnostic[] = [];

  // ---- 1. XML 解析 ----
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    diags.push({
      severity: "error",
      message: `XML 解析错误: ${parseError.textContent?.slice(0, 200) ?? "未知"}`,
    });
    return { hasError: true, diagnostics: diags, parts: [], pivotMap: new Map(), root: null };
  }

  const svgRoot = doc.documentElement;
  if (
    !svgRoot ||
    svgRoot.localName !== "svg" ||
    svgRoot.namespaceURI !== SVG_NAMESPACE
  ) {
    diags.push({ severity: "error", message: "根元素不是 <svg>" });
    return { hasError: true, diagnostics: diags, parts: [], pivotMap: new Map(), root: null };
  }

  const root = svgRoot as unknown as SVGSVGElement;
  const allElements = [root, ...root.querySelectorAll("*")];

  // ---- 2 & 3. 危险标签 + 完整 on* 遍历 ----
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "foreignobject") {
      diags.push({
        severity: "error",
        message: `禁止标签: <${tag}> (#${el.getAttribute("id") || "无ID"})`,
      });
      continue;
    }

    for (let i = 0; i < el.attributes.length; i++) {
      const name = el.attributes[i].name.toLowerCase();
      if (name.startsWith("on")) {
        diags.push({
          severity: "error",
          message: `禁止事件属性: ${name} 在 <${tag}> (#${el.getAttribute("id") || "无ID"})`,
        });
      }
    }
  }

  // ---- 4. href/xlink:href 只允许同文档片段引用 ----
  for (const el of allElements) {
    const href = el.getAttribute("href") || "";
    const xlinkHref = el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
    for (const val of [href, xlinkHref]) {
      if (!val) continue;
      const trimmed = val.trim();
      if (!trimmed.startsWith("#")) {
        diags.push({
          severity: "error",
          message: `禁止外部引用: "${trimmed}" 在 <${el.tagName.toLowerCase()}>`,
        });
      }
    }
  }

  // ---- 5. 任意属性与 <style> 内的 CSS url(...) 只允许 url(#id) ----
  for (const el of allElements) {
    const cssSources = Array.from(el.attributes, (attribute) => attribute.value);
    if (el.tagName.toLowerCase() === "style") {
      cssSources.push(el.textContent ?? "");
    }

    for (const cssSource of cssSources) {
      if (el.localName === "style" && /@import\b/i.test(cssSource)) {
        diags.push({
          severity: "error",
          message: "禁止 CSS @import 在 <style>",
        });
      }

      const urlMatches = cssSource.matchAll(/url\(([^)]*)\)/gi);
      for (const match of urlMatches) {
        const url = match[1].replace(/['"]/g, "").trim();
        if (!url.startsWith("#")) {
          diags.push({
            severity: "error",
            message: `禁止 CSS 外部 url: "${url}" 在 <${el.tagName.toLowerCase()}>`,
          });
        }
      }
    }
  }

  // ---- 6. 重复 ID ----
  const idCount = new Map<string, number>();
  for (const el of allElements) {
    const id = el.getAttribute("id");
    if (id) idCount.set(id, (idCount.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCount) {
    if (count > 1) {
      diags.push({ severity: "error", message: `重复 ID: "${id}" (${count} 次)` });
    }
  }

  // ---- 7. 发现 Part 和 pivot ----
  const parts: PartInfo[] = [];
  const pivotMap = new Map<string, PivotInfo>();
  const seenLabels = new Map<string, number>();

  for (const el of allElements) {
    const label = (el as Element).getAttribute("inkscape:label");
    if (!label) continue;

    // pivot 标记
    if (label.startsWith("pivot_")) {
      const partId = label.replace(/^pivot_/, "");
      const tag = el.tagName.toLowerCase();

      // Only circle/ellipse/rect are supported for pivot
      let cx: number, cy: number;
      if (tag === "circle" || tag === "ellipse") {
        cx = parseFloat((el as Element).getAttribute("cx") ?? "NaN");
        cy = parseFloat((el as Element).getAttribute("cy") ?? "NaN");
      } else if (tag === "rect") {
        const x = parseFloat((el as Element).getAttribute("x") ?? "0");
        const y = parseFloat((el as Element).getAttribute("y") ?? "0");
        const w = parseFloat((el as Element).getAttribute("width") ?? "0");
        const h = parseFloat((el as Element).getAttribute("height") ?? "0");
        cx = x + w / 2;
        cy = y + h / 2;
      } else {
        diags.push({
          severity: "error",
          message: `pivot "${partId}" 使用不支持的标签 <${tag}>，仅支持 circle/ellipse/rect`,
        });
        continue;
      }

      if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
        diags.push({
          severity: "error",
          message: `pivot "${partId}" 坐标无效: cx=${cx}, cy=${cy}`,
        });
        continue;
      }

      if (pivotMap.has(partId)) {
        diags.push({ severity: "error", message: `重复 pivot label: "pivot_${partId}"` });
        continue;
      }

      pivotMap.set(partId, {
        x: cx,
        y: cy,
        sourceElementId: (el as Element).getAttribute("id") ?? "",
      });
      continue;
    }

    // 容器 label 跳过
    if (CONTAINER_LABELS.has(label)) continue;

    // 语义部件
    const existing = seenLabels.get(label) ?? 0;
    seenLabels.set(label, existing + 1);
    if (existing > 0) {
      diags.push({ severity: "error", message: `重复 label: "${label}"` });
    }

    const domId = (el as Element).getAttribute("id") ?? "";
    if (!domId) {
      diags.push({ severity: "error", message: `部件 "${label}" 缺少 DOM id` });
    }

    parts.push({ partId: label, inkscapeLabel: label, sourceElementId: domId });
  }

  // 孤立 pivot
  for (const [partId] of pivotMap) {
    if (!seenLabels.has(partId)) {
      diags.push({ severity: "warn", message: `孤立 pivot_${partId}，无对应部件` });
    }
  }

  // 缺少 pivot（info，不阻塞）
  for (const p of parts) {
    if (!pivotMap.has(p.partId)) {
      diags.push({ severity: "info", message: `部件 "${p.partId}" 缺少 pivot 标记` });
    }
  }

  const hasError = diags.some((d) => d.severity === "error");
  return { hasError, diagnostics: diags, parts, pivotMap, root };
}
