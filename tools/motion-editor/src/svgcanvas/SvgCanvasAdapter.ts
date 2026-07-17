/**
 * P0 适配器：封装 @svgedit/svgcanvas，向上层提供语义 Part ID 接口。
 *
 * 所有上游调用集中在此文件，React 组件不散落调用 svgcanvas。
 */

// @ts-ignore — @svgedit/svgcanvas 无内置类型声明
import SvgCanvas from "@svgedit/svgcanvas";

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface ImportedPartRef {
  partId: string;
  inkscapeLabel: string;
  sourceElementId: string;
  element: SVGElement;
}

export interface Diagnostic {
  severity: "error" | "warn" | "info";
  message: string;
}

export interface ImportResult {
  parts: ImportedPartRef[];
  diagnostics: Diagnostic[];
}

export interface PreviewTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

export interface StageAdapter {
  mount(container: HTMLElement): void;
  getVersion(): string;
  loadSvg(source: string): ImportResult;
  selectPart(partId: string): boolean;
  applyPreviewTransform(partId: string, transform: PreviewTransform): void;
  restoreBindPose(partId: string): void;
  getSerializedPreview(): string;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// 实现
// ---------------------------------------------------------------------------

export class SvgCanvasAdapter implements StageAdapter {
  private canvas: any = null;
  private partIndex = new Map<string, ImportedPartRef>();
  /** 记录 bind transform 原始值，用于恢复（null = 原节点无 transform 属性） */
  private bindTransforms = new Map<string, string | null>();

  mount(container: HTMLElement): void {
    if (this.canvas) {
      throw new Error("SvgCanvas 已挂载，请先 dispose()");
    }
    this.canvas = new SvgCanvas(container, {
      show_outside_canvas: true,
      initFill: { color: "transparent", opacity: 0 },
      initStroke: { width: 0, opacity: 0 },
    });
  }

  getVersion(): string {
    return "7.4.2";
  }

  loadSvg(source: string): ImportResult {
    if (!this.canvas) throw new Error("SvgCanvas 未初始化");
    this.partIndex.clear();
    this.bindTransforms.clear();

    const diags: Diagnostic[] = [];

    // Step 1: parse with DOMParser for diagnostics
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, "image/svg+xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      diags.push({
        severity: "error",
        message: `SVG 解析失败: ${parseError.textContent?.slice(0, 200)}`,
      });
      return { parts: [], diagnostics: diags };
    }

    const svgRoot = doc.documentElement;
    if (svgRoot.tagName.toLowerCase() !== "svg") {
      diags.push({ severity: "error", message: "根元素不是 <svg>" });
      return { parts: [], diagnostics: diags };
    }

    // Security check: reject dangerous nodes
    const dangerous = svgRoot.querySelectorAll(
      "script, foreignObject, [onclick], [onload], [onerror], [onmouseover]",
    );
    dangerous.forEach((n) => {
      diags.push({
        severity: "error",
        message: `安全拒绝: <${n.tagName}> (${n.getAttribute("id") || "无ID"})`,
      });
    });
    if (dangerous.length > 0) {
      return { parts: [], diagnostics: diags };
    }

    // Check external references
    const externals = svgRoot.querySelectorAll(
      '[href^="http"], [xlink\\:href^="http"], [href^="//"]',
    );
    externals.forEach((n) => {
      diags.push({
        severity: "warn",
        message: `外部引用: ${n.getAttribute("href") || n.getAttributeNS("http://www.w3.org/1999/xlink", "href")}`,
      });
    });

    // Step 2: discover semantic parts via inkscape:label
    const labelElements = svgRoot.querySelectorAll("[inkscape\\:label]");
    const seenLabels = new Map<string, number>();
    const parts: ImportedPartRef[] = [];
    const pivotLabels = new Set<string>();

    labelElements.forEach((el) => {
      const label = (el as Element).getAttribute("inkscape:label") ?? "";
      if (!label) return;

      // Track pivot labels
      if (label.startsWith("pivot_")) {
        pivotLabels.add(label.replace(/^pivot_/, ""));
        return; // pivots are not parts themselves
      }

      // Skip non-semantic labels
      // Skip non-semantic labels (internal groupings like "character", "hair_accessory")
      const isPart =
        label !== "character" && label !== "hair_accessory";

      if (isPart) {
        const existing = seenLabels.get(label) ?? 0;
        if (existing > 0) {
          diags.push({
            severity: "warn",
            message: `重复 label: "${label}" 出现 ${existing + 1} 次`,
          });
        }
        seenLabels.set(label, existing + 1);

        const domId = (el as Element).getAttribute("id") ?? "";
        if (!domId) {
          diags.push({
            severity: "warn",
            message: `部件 "${label}" 缺少 DOM id`,
          });
        }
        if (domId && seenLabels.get(label)! > 1) {
          diags.push({
            severity: "warn",
            message: `重复 DOM id "${domId}" 用于 label "${label}"`,
          });
        }

        parts.push({
          partId: label,
          inkscapeLabel: label,
          sourceElementId: domId,
          // element will be resolved after loading into svgcanvas
          element: null as unknown as SVGElement,
        });
      }
    });

    // Step 3: load into svgcanvas
    this.canvas.setSvgString(source);

    // Step 4: resolve element references from svgcanvas DOM
    const svgCanvasRoot = this.canvas.getSvgRoot() as SVGSVGElement | null;
    if (svgCanvasRoot) {
      const resolvedParts: ImportedPartRef[] = [];
      for (const part of parts) {
        const el = svgCanvasRoot.querySelector(
          `[id="${part.sourceElementId}"]`,
        ) as SVGElement | null;
        if (el) {
          resolvedParts.push({ ...part, element: el });

          // Capture bind transform
          const origTransform = el.getAttribute("transform");
          this.bindTransforms.set(part.partId, origTransform);
        } else {
          diags.push({
            severity: "warn",
            message: `部件 "${part.partId}" (DOM id: ${part.sourceElementId}) 在 svgcanvas 中未找到`,
          });
          resolvedParts.push(part);
        }
      }
      // Build part index
      for (const p of resolvedParts) {
        this.partIndex.set(p.partId, p);
      }

      // Check for pivots without corresponding parts
      for (const pivotPart of pivotLabels) {
        if (!seenLabels.has(pivotPart)) {
          diags.push({
            severity: "warn",
            message: `孤立 pivot: pivot_${pivotPart} 存在但无对应部件 "${pivotPart}"`,
          });
        }
      }

      // Check for parts without pivot
      for (const p of resolvedParts) {
        if (!pivotLabels.has(p.partId)) {
          diags.push({
            severity: "info",
            message: `部件 "${p.partId}" 缺少 pivot 标记`,
          });
        }
      }

      diags.push({
        severity: "info",
        message: `导入完成: ${resolvedParts.length} 个部件, ${pivotLabels.size} 个 pivot 标记`,
      });

      return { parts: resolvedParts, diagnostics: diags };
    }

    diags.push({ severity: "error", message: "svgcanvas 根节点获取失败" });
    return { parts, diagnostics: diags };
  }

  selectPart(partId: string): boolean {
    if (!this.canvas) return false;
    const ref = this.partIndex.get(partId);
    if (!ref || !ref.element) return false;

    try {
      this.canvas.selectOnly([ref.element], true);
      return true;
    } catch {
      return false;
    }
  }

  applyPreviewTransform(partId: string, transform: PreviewTransform): void {
    if (!this.canvas) return;
    const ref = this.partIndex.get(partId);
    if (!ref || !ref.element) return;

    // Build transform string
    const parts: string[] = [];
    if (transform.x !== 0 || transform.y !== 0) {
      parts.push(`translate(${transform.x}, ${transform.y})`);
    }
    if (transform.rotation !== 0) {
      parts.push(`rotate(${transform.rotation})`);
    }
    if (transform.scaleX !== 1 || transform.scaleY !== 1) {
      parts.push(`scale(${transform.scaleX}, ${transform.scaleY})`);
    }

    const tStr = parts.join(" ") || "";

    try {
      this.canvas.selectOnly([ref.element], true);
      const attr = "transform";
      // @ts-ignore — svgcanvas allows null to remove attribute
      const val: string = tStr || "";
      this.canvas.changeSelectedAttributeNoUndo(attr, val);
    } catch {
      // ignore
    }
  }

  restoreBindPose(partId: string): void {
    if (!this.canvas) return;
    const ref = this.partIndex.get(partId);
    if (!ref || !ref.element) return;

    const origTransform = this.bindTransforms.get(partId);
    try {
      this.canvas.selectOnly([ref.element], true);
      // @ts-ignore — svgcanvas allows empty string to clear attribute
      this.canvas.changeSelectedAttributeNoUndo(
        "transform",
        origTransform ?? "",
      );
    } catch {
      // ignore
    }
  }

  getSerializedPreview(): string {
    if (!this.canvas) return "";
    try {
      return this.canvas.getSvgString() ?? "";
    } catch {
      return "";
    }
  }

  dispose(): void {
    // Restore all part transforms before destroying
    for (const partId of this.bindTransforms.keys()) {
      this.restoreBindPose(partId);
    }
    this.bindTransforms.clear();
    this.partIndex.clear();
    this.canvas = null;
  }
}
