/**
 * svgcanvas 舞台适配器。
 *
 * DOM/svgcanvas 只负责素材载入、选择和坐标测量；矩阵组合使用共享核心，保证编辑器
 * 与未来桌宠运行时遵循同一语义。
 */

import SvgCanvas from "@svgedit/svgcanvas";
import {
  composeAroundPivot,
  computePivotInPartLocal,
  identity,
  multiply,
} from "@ltypet/character-motion";
import type { AffineMatrix, CharacterRigV1, SourceBinding } from "@ltypet/character-motion";
import {
  findSourceBindingMatches,
  inspectSvgForImport,
} from "../import/inspectSvgForImport";

export interface ImportedPartRef {
  partId: string;
  inkscapeLabel: string;
  sourceElementId: string;
  element: SVGElement;
  bindMatrix: AffineMatrix;
  originalTransform: string | null;
  originalOpacity: string | null;
  originalDisplay: string | null;
  sourceOrder: number;
  originalParent: Node | null;
  originalNextSibling: Node | null;
}

export interface PartScreenGeometry {
  bounds: { left: number; top: number; width: number; height: number };
  pivot: { x: number; y: number };
  axisX: { x: number; y: number };
  axisY: { x: number; y: number };
}

export interface Diagnostic {
  severity: "error" | "warn" | "info";
  message: string;
}

export interface ImportResult {
  parts: ImportedPartRef[];
  pivotLocal: Map<string, { x: number; y: number }>;
  viewBox: [number, number, number, number];
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
  bindRig(rig: CharacterRigV1): ImportResult;
  selectPart(partId: string): boolean;
  onPartSelected(listener: ((partId: string) => void) | null): void;
  applyPreviewTransform(partId: string, transform: PreviewTransform): void;
  restoreBindPose(partId: string): void;
  getPivotLocal(partId: string): { x: number; y: number } | null;
  setPivotLocal(partId: string, pivot: { x: number; y: number }): void;
  setPartVisible(partId: string, visible: boolean): void;
  setPartLocked(partId: string, locked: boolean): void;
  getPartScreenGeometry(partId: string, relativeTo: HTMLElement): PartScreenGeometry | null;
  screenDeltaToSvg(deltaX: number, deltaY: number): { x: number; y: number } | null;
  screenDeltaToPartLocal(partId: string, deltaX: number, deltaY: number): { x: number; y: number } | null;
  fitArtworkToViewport(): void;
  applyRenderSlots(
    defaultSlots: Map<string, string>,
    overrides: Map<string, string>,
    slotOrder: string[],
  ): void;
  getSerializedPreview(): string;
  dispose(): void;
}

const DEFAULT_VIEW_BOX: [number, number, number, number] = [0, 0, 1, 1];

function matrixToString(matrix: AffineMatrix): string {
  return `matrix(${matrix.join(" ")})`;
}

function sourceBindingKey(binding: SourceBinding): string {
  return `${binding.kind}\0${binding.value}`;
}

function domMatrixToTuple(matrix: DOMMatrix): AffineMatrix {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
}

function readViewBox(root: SVGSVGElement): [number, number, number, number] {
  // Parse the source attribute first. SVGAnimatedRect commonly rounds through
  // float32 (for example 33.790157 -> 33.790157318...), which breaks exact rig
  // artwork matching even though the authored viewBox text is unchanged.
  const raw = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (
    raw?.length === 4 &&
    raw.every(Number.isFinite) &&
    raw[2] > 0 &&
    raw[3] > 0
  ) {
    return raw as [number, number, number, number];
  }

  const baseVal = root.viewBox?.baseVal;
  if (
    baseVal &&
    Number.isFinite(baseVal.x) &&
    Number.isFinite(baseVal.y) &&
    Number.isFinite(baseVal.width) &&
    Number.isFinite(baseVal.height) &&
    baseVal.width > 0 &&
    baseVal.height > 0
  ) {
    return [baseVal.x, baseVal.y, baseVal.width, baseVal.height];
  }

  return DEFAULT_VIEW_BOX;
}

/** Read only the element's own SVG transform, never its world CTM. */
function readLocalBindMatrix(
  element: SVGElement,
  partId: string,
  diagnostics: Diagnostic[],
): AffineMatrix {
  const rawTransform = element.getAttribute("transform");
  if (!rawTransform) return identity();

  const graphicsElement = element as SVGGraphicsElement;
  const consolidated = graphicsElement.transform?.baseVal?.consolidate();
  if (consolidated) return domMatrixToTuple(consolidated.matrix);

  diagnostics.push({
    severity: "error",
    message: `部件 "${partId}" 的局部 transform 无法解析，已拒绝生成 rig`,
  });
  return identity();
}

export class SvgCanvasAdapter implements StageAdapter {
  private canvas: SvgCanvas | null = null;
  private readonly partIndex = new Map<string, ImportedPartRef>();
  private readonly pivotLocal = new Map<string, { x: number; y: number }>();
  private readonly lockedParts = new Set<string>();
  private selectionListener: ((partId: string) => void) | null = null;
  private stagePointerHandler: ((event: PointerEvent) => void) | null = null;
  private suppressSelectionCallback = false;
  private container: HTMLElement | null = null;
  private renderOrderAltered = false;
  private readonly loadedBindingElementIds = new Map<string, string[]>();

  mount(container: HTMLElement): void {
    if (this.canvas) throw new Error("SvgCanvas 已挂载");
    this.canvas = new SvgCanvas(container, {
      show_outside_canvas: true,
      initFill: { color: "transparent", opacity: 0 },
      initStroke: { width: 0, opacity: 0 },
    });
    this.container = container;
  }

  getVersion(): string {
    return "7.4.2";
  }

  loadSvg(source: string): ImportResult {
    if (!this.canvas) throw new Error("SvgCanvas 未初始化");
    this.restoreAllBindPoses();
    if (this.renderOrderAltered) this.restoreRenderOrder();
    this.partIndex.clear();
    this.pivotLocal.clear();

    const inspection = inspectSvgForImport(source);
    const diagnostics: Diagnostic[] = [...inspection.diagnostics];
    if (inspection.hasError) {
      diagnostics.unshift({ severity: "error", message: "安全导入拒绝：SVG 未进入 svgcanvas" });
      return { parts: [], pivotLocal: new Map(), viewBox: DEFAULT_VIEW_BOX, diagnostics };
    }

    this.loadedBindingElementIds.clear();
    if (inspection.root) {
      const elements = [inspection.root, ...inspection.root.querySelectorAll("*")]
        .filter((element): element is SVGElement => element instanceof SVGElement && element.id.length > 0);
      for (const element of elements) {
        const bindings: SourceBinding[] = [{ kind: "elementId", value: element.id }];
        const label = element.getAttributeNS("http://www.inkscape.org/namespaces/inkscape", "label");
        if (label) bindings.push({ kind: "inkscapeLabel", value: label });
        const dataPart = element.getAttribute("data-part");
        if (dataPart) bindings.push({ kind: "dataPart", value: dataPart });
        for (const binding of bindings) {
          const key = sourceBindingKey(binding);
          this.loadedBindingElementIds.set(key, [...(this.loadedBindingElementIds.get(key) ?? []), element.id]);
        }
      }
    }

    if (!this.canvas.setSvgString(source)) {
      throw new Error("svgcanvas 拒绝载入 SVG");
    }
    const root = this.canvas.getSvgRoot();
    const parts: ImportedPartRef[] = [];

    for (const [sourceOrder, part] of inspection.parts.entries()) {
      const element = root.ownerDocument.getElementById(part.sourceElementId);
      if (!(element instanceof SVGElement)) {
        diagnostics.push({
          severity: "error",
          message: `部件 "${part.partId}" (#${part.sourceElementId}) 在 svgcanvas 中未找到`,
        });
        continue;
      }

      const ref: ImportedPartRef = {
        partId: part.partId,
        inkscapeLabel: part.inkscapeLabel,
        sourceElementId: part.sourceElementId,
        element,
        bindMatrix: readLocalBindMatrix(element, part.partId, diagnostics),
        originalTransform: element.getAttribute("transform"),
        originalOpacity: element.getAttribute("opacity"),
        originalDisplay: element.getAttribute("display"),
        sourceOrder,
        originalParent: element.parentNode,
        originalNextSibling: element.nextSibling,
      };
      parts.push(ref);
      this.partIndex.set(part.partId, ref);
    }

    for (const [partId, pivotInfo] of inspection.pivotMap) {
      const part = this.partIndex.get(partId);
      if (!part) continue;

      const pivotElement = root.ownerDocument.getElementById(pivotInfo.sourceElementId);
      if (!(pivotElement instanceof SVGGraphicsElement)) {
        diagnostics.push({ severity: "error", message: `pivot "${partId}" 在 svgcanvas 中未找到` });
        continue;
      }

      const partCtm = (part.element as SVGGraphicsElement).getCTM();
      const pivotCtm = pivotElement.getCTM();
      if (!partCtm || !pivotCtm) {
        diagnostics.push({ severity: "error", message: `无法测量 "${partId}" 的 pivot CTM` });
        continue;
      }

      const pivotWorld = {
        x: pivotCtm.a * pivotInfo.x + pivotCtm.c * pivotInfo.y + pivotCtm.e,
        y: pivotCtm.b * pivotInfo.x + pivotCtm.d * pivotInfo.y + pivotCtm.f,
      };
      const local = computePivotInPartLocal(domMatrixToTuple(partCtm), pivotWorld);
      if (!local || !Number.isFinite(local.x) || !Number.isFinite(local.y)) {
        diagnostics.push({ severity: "error", message: `部件 "${partId}" 的 pivot 无法换算` });
        continue;
      }

      this.pivotLocal.set(partId, local);
      diagnostics.push({
        severity: "info",
        message: `pivot "${partId}": (${local.x.toFixed(4)}, ${local.y.toFixed(4)}) part-local`,
      });
    }

    diagnostics.push({
      severity: "info",
      message: `导入完成: ${parts.length} 个部件, ${this.pivotLocal.size} 个 pivot`,
    });
    this.installStageSelection(root);
    this.fitArtworkToViewport();

    return {
      parts,
      pivotLocal: new Map(this.pivotLocal),
      viewBox: readViewBox(this.canvas.getSvgContent()),
      diagnostics,
    };
  }

  selectPart(partId: string): boolean {
    const part = this.partIndex.get(partId);
    if (!this.canvas || !part) return false;
    this.suppressSelectionCallback = true;
    this.canvas.selectOnly([part.element], false);
    this.suppressSelectionCallback = false;
    return true;
  }

  bindRig(rig: CharacterRigV1): ImportResult {
    if (!this.canvas) throw new Error("SvgCanvas 未初始化");
    const root = this.canvas.getSvgRoot();
    const content = this.canvas.getSvgContent();
    const diagnostics: Diagnostic[] = [];
    const refs: ImportedPartRef[] = [];
    const nextIndex = new Map<string, ImportedPartRef>();
    const nextPivots = new Map<string, { x: number; y: number }>();
    const claimedElements = new Map<SVGElement, string>();
    const sourceOrder = new Map(
      [content, ...content.querySelectorAll("*")].map((element, index) => [element, index]),
    );

    for (const rigPart of rig.parts) {
      if (nextIndex.has(rigPart.id)) {
        diagnostics.push({
          severity: "error",
          message: `Rig Part ID 重复: "${rigPart.id}"`,
        });
        continue;
      }
      const preservedIds = this.loadedBindingElementIds.get(sourceBindingKey(rigPart.sourceBinding));
      const matches = preservedIds
        ? preservedIds.flatMap((id) => {
            const element = root.ownerDocument.getElementById(id);
            return element instanceof SVGElement ? [element] : [];
          })
        : findSourceBindingMatches(content, rigPart.sourceBinding);
      if (matches.length !== 1) {
        diagnostics.push({
          severity: "error",
          message: `Rig Part "${rigPart.id}" 的 ${formatSourceBinding(rigPart.sourceBinding)} 命中 ${matches.length} 个节点`,
        });
        continue;
      }

      const element = matches[0];
      const claimedBy = claimedElements.get(element);
      if (claimedBy) {
        diagnostics.push({
          severity: "error",
          message: `Rig Part "${rigPart.id}" 与 "${claimedBy}" 绑定到同一素材节点`,
        });
        continue;
      }
      claimedElements.set(element, rigPart.id);
      const ref: ImportedPartRef = {
        partId: rigPart.id,
        inkscapeLabel: element.getAttributeNS(
          "http://www.inkscape.org/namespaces/inkscape",
          "label",
        ) ?? "",
        sourceElementId: element.id,
        element,
        bindMatrix: [...rigPart.bindMatrix],
        originalTransform: element.getAttribute("transform"),
        originalOpacity: element.getAttribute("opacity"),
        originalDisplay: element.getAttribute("display"),
        sourceOrder: sourceOrder.get(element) ?? Number.MAX_SAFE_INTEGER,
        originalParent: element.parentNode,
        originalNextSibling: element.nextSibling,
      };
      refs.push(ref);
      nextIndex.set(rigPart.id, ref);
      nextPivots.set(rigPart.id, { x: rigPart.pivot.x, y: rigPart.pivot.y });
    }

    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return {
        parts: [],
        pivotLocal: new Map(),
        viewBox: readViewBox(content),
        diagnostics,
      };
    }

    this.restoreAllBindPoses();
    if (this.renderOrderAltered) this.restoreRenderOrder();
    this.partIndex.clear();
    this.pivotLocal.clear();
    for (const [partId, ref] of nextIndex) this.partIndex.set(partId, ref);
    for (const [partId, pivot] of nextPivots) this.pivotLocal.set(partId, pivot);
    this.installStageSelection(root);

    diagnostics.push({
      severity: "info",
      message: `Rig 绑定完成: ${refs.length} 个部件`,
    });
    return {
      parts: refs,
      pivotLocal: new Map(this.pivotLocal),
      viewBox: readViewBox(content),
      diagnostics,
    };
  }

  onPartSelected(listener: ((partId: string) => void) | null): void {
    this.selectionListener = listener;
  }

  applyPreviewTransform(partId: string, transform: PreviewTransform): void {
    const part = this.partIndex.get(partId);
    if (!part) return;

    const pivot = this.pivotLocal.get(partId) ?? { x: 0, y: 0 };
    const authored = composeAroundPivot(
      transform.x,
      transform.y,
      transform.rotation,
      transform.scaleX,
      transform.scaleY,
      pivot.x,
      pivot.y,
    );
    part.element.setAttribute("transform", matrixToString(multiply(part.bindMatrix, authored)));
    part.element.setAttribute("opacity", String(transform.opacity));
  }

  restoreBindPose(partId: string): void {
    const part = this.partIndex.get(partId);
    if (!part) return;

    if (part.originalTransform === null) part.element.removeAttribute("transform");
    else part.element.setAttribute("transform", part.originalTransform);

    if (part.originalOpacity === null) part.element.removeAttribute("opacity");
    else part.element.setAttribute("opacity", part.originalOpacity);
  }

  getPivotLocal(partId: string): { x: number; y: number } | null {
    return this.pivotLocal.get(partId) ?? null;
  }

  setPivotLocal(partId: string, pivot: { x: number; y: number }): void {
    if (!this.partIndex.has(partId)) return;
    this.pivotLocal.set(partId, { ...pivot });
  }

  setPartVisible(partId: string, visible: boolean): void {
    const part = this.partIndex.get(partId);
    if (!part) return;
    if (visible) {
      if (part.originalDisplay === null) part.element.removeAttribute("display");
      else part.element.setAttribute("display", part.originalDisplay);
    } else {
      part.element.setAttribute("display", "none");
    }
  }

  setPartLocked(partId: string, locked: boolean): void {
    if (locked) this.lockedParts.add(partId);
    else this.lockedParts.delete(partId);
  }

  getPartScreenGeometry(partId: string, relativeTo: HTMLElement): PartScreenGeometry | null {
    const part = this.partIndex.get(partId);
    const pivot = this.pivotLocal.get(partId);
    if (!part || !pivot || !(part.element instanceof SVGGraphicsElement)) return null;
    const rect = part.element.getBoundingClientRect();
    const relativeRect = relativeTo.getBoundingClientRect();
    const matrix = part.element.getScreenCTM();
    if (!matrix) return null;
    const axisXLength = Math.hypot(matrix.a, matrix.b) || 1;
    const axisYLength = Math.hypot(matrix.c, matrix.d) || 1;
    return {
      bounds: {
        left: rect.left - relativeRect.left,
        top: rect.top - relativeRect.top,
        width: rect.width,
        height: rect.height,
      },
      pivot: {
        x: matrix.a * pivot.x + matrix.c * pivot.y + matrix.e - relativeRect.left,
        y: matrix.b * pivot.x + matrix.d * pivot.y + matrix.f - relativeRect.top,
      },
      axisX: { x: matrix.a / axisXLength, y: matrix.b / axisXLength },
      axisY: { x: matrix.c / axisYLength, y: matrix.d / axisYLength },
    };
  }

  screenDeltaToSvg(deltaX: number, deltaY: number): { x: number; y: number } | null {
    const matrix = this.canvas?.getSvgRoot().getScreenCTM();
    if (!matrix) return null;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < 1e-12) return null;
    return {
      x: (matrix.d * deltaX - matrix.c * deltaY) / determinant,
      y: (-matrix.b * deltaX + matrix.a * deltaY) / determinant,
    };
  }

  screenDeltaToPartLocal(partId: string, deltaX: number, deltaY: number): { x: number; y: number } | null {
    const part = this.partIndex.get(partId);
    if (!part || !(part.element instanceof SVGGraphicsElement)) return null;
    const matrix = part.element.getScreenCTM();
    if (!matrix) return null;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < 1e-12) return null;
    return {
      x: (matrix.d * deltaX - matrix.c * deltaY) / determinant,
      y: (-matrix.b * deltaX + matrix.a * deltaY) / determinant,
    };
  }

  fitArtworkToViewport(): void {
    const content = this.canvas?.getSvgContent();
    if (!content || !this.container) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    content.setAttribute("width", String(width));
    content.setAttribute("height", String(height));
    content.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  applyRenderSlots(
    defaultSlots: Map<string, string>,
    overrides: Map<string, string>,
    slotOrder: string[],
  ): void {
    const changedOverrides = new Map(
      [...overrides].filter(([partId, slot]) => slot !== defaultSlots.get(partId)),
    );
    if (changedOverrides.size === 0) {
      if (this.renderOrderAltered) this.restoreRenderOrder();
      return;
    }
    if (this.renderOrderAltered) this.restoreRenderOrder();
    const slotIndex = new Map(slotOrder.map((slot, index) => [slot, index]));
    const groups = new Map<Node, ImportedPartRef[]>();
    for (const part of this.partIndex.values()) {
      const parent = part.element.parentNode;
      if (!parent) continue;
      const list = groups.get(parent) ?? [];
      list.push(part);
      groups.set(parent, list);
    }
    for (const [parent, parts] of groups) {
      parts.sort((left, right) => {
        const leftSlot = changedOverrides.get(left.partId) ?? defaultSlots.get(left.partId) ?? "";
        const rightSlot = changedOverrides.get(right.partId) ?? defaultSlots.get(right.partId) ?? "";
        const slotDifference = (slotIndex.get(leftSlot) ?? 0) - (slotIndex.get(rightSlot) ?? 0);
        return slotDifference || left.sourceOrder - right.sourceOrder;
      });
      for (const part of parts) parent.appendChild(part.element);
    }
    this.renderOrderAltered = true;
  }

  getSerializedPreview(): string {
    return this.canvas?.getSvgString() ?? "";
  }

  dispose(): void {
    const container = this.container;
    this.removeStageSelection();
    this.restoreAllBindPoses();
    if (this.renderOrderAltered) this.restoreRenderOrder();
    this.partIndex.clear();
    this.pivotLocal.clear();
    this.loadedBindingElementIds.clear();
    this.lockedParts.clear();
    this.selectionListener = null;
    this.container = null;
    this.canvas = null;
    container?.replaceChildren();
  }

  private restoreAllBindPoses(): void {
    for (const partId of this.partIndex.keys()) this.restoreBindPose(partId);
  }

  private restoreRenderOrder(): void {
    const parts = [...this.partIndex.values()].sort((left, right) => right.sourceOrder - left.sourceOrder);
    for (const part of parts) {
      const parent = part.originalParent;
      if (!parent) continue;
      const next = part.originalNextSibling;
      parent.insertBefore(part.element, next?.parentNode === parent ? next : null);
    }
    this.renderOrderAltered = false;
  }

  private installStageSelection(root: SVGSVGElement): void {
    this.removeStageSelection();
    this.stagePointerHandler = (event: PointerEvent) => {
      if (event.button !== 0 || this.suppressSelectionCallback) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      const matches = [...this.partIndex.values()]
        .filter((part) => part.element === target || part.element.contains(target))
        .sort((left, right) => left.element.contains(right.element) ? 1 : -1);
      const part = matches[0];
      if (!part || this.lockedParts.has(part.partId)) return;
      event.preventDefault();
      event.stopPropagation();
      this.selectPart(part.partId);
      this.selectionListener?.(part.partId);
    };
    root.addEventListener("pointerdown", this.stagePointerHandler, true);
  }

  private removeStageSelection(): void {
    const root = this.canvas?.getSvgRoot();
    if (root && this.stagePointerHandler) {
      root.removeEventListener("pointerdown", this.stagePointerHandler, true);
    }
    this.stagePointerHandler = null;
  }
}

function formatSourceBinding(binding: SourceBinding): string {
  return `${binding.kind}="${binding.value}"`;
}
