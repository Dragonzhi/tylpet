import {
  invert,
  multiply,
  resolveAllPoses,
  sampleMotionClip,
  type AffineMatrix,
  type CharacterRigV1,
  type MotionClipV1,
  type RigPartV1,
  type SourceBinding,
} from "@ltypet/character-motion";

interface RuntimePart {
  definition: RigPartV1;
  source: SVGGraphicsElement;
  authored: SVGGElement;
  slotNode: SVGGraphicsElement;
  originalSlotParent: Node;
  originalSlotMarker: Comment;
  originalSourceTransform: string | null;
  currentSlot: string;
  worldAlignment: AffineMatrix;
  parentBindMatrix: AffineMatrix;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const INTERACTION_IDS = new Set([
  "arm-left-follow",
  "arm-right-follow",
  "hair-tail-left-head-follow",
  "hair-tail-right-head-follow",
]);
const PROCEDURAL_SUFFIX = "-motion";

const matrixAttribute = (matrix: AffineMatrix) =>
  `matrix(${matrix.map((value) => Number(value.toFixed(8))).join(" ")})`;

const isIdentity = (matrix: AffineMatrix) =>
  matrix.every((value, index) => Math.abs(value - [1, 0, 0, 1, 0, 0][index]) < 1e-12);

const isGroup = (element: Element | null): element is SVGGElement =>
  element?.namespaceURI === SVG_NS && element.localName === "g";

const bindingMatches = (element: Element, binding: SourceBinding) => {
  if (binding.kind === "inkscapeLabel") {
    return element.getAttribute("inkscape:label") === binding.value ||
      element.getAttributeNS("http://www.inkscape.org/namespaces/inkscape", "label") === binding.value;
  }
  if (binding.kind === "dataPart") return element.getAttribute("data-part") === binding.value;
  return element.id === binding.value;
};

const findUniqueSource = (
  svg: SVGSVGElement,
  part: RigPartV1,
): SVGGraphicsElement => {
  const matches = Array.from(svg.querySelectorAll<SVGGraphicsElement>("g,path,rect,circle,ellipse,polygon,polyline,line,use"))
    .filter((element) => bindingMatches(element, part.sourceBinding));
  if (matches.length !== 1) {
    throw new Error(`Part ${part.id} 的 sourceBinding 命中 ${matches.length} 个节点`);
  }
  return matches[0];
};

const findPartLayers = (source: SVGGraphicsElement) => {
  const procedural =
    isGroup(source.parentElement) && source.parentElement.id.endsWith(PROCEDURAL_SUFFIX)
      ? source.parentElement
      : source;
  const potentialInteraction = procedural.parentElement;
  const interaction =
    isGroup(potentialInteraction) && INTERACTION_IDS.has(potentialInteraction.id)
      ? potentialInteraction
      : null;
  return { procedural, interaction };
};

const toAffineMatrix = (matrix: DOMMatrix): AffineMatrix => [
  matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f,
];

const getCtm = (element: SVGGraphicsElement): AffineMatrix => {
  const matrix = element.getCTM();
  if (!matrix) throw new Error(`无法读取 ${element.id || element.localName} 的 CTM`);
  return toAffineMatrix(matrix);
};


const hasCtm = (element: Element | null): element is SVGGraphicsElement =>
  element !== null && element.namespaceURI === SVG_NS &&
  typeof (element as unknown as { getCTM?: unknown }).getCTM === "function";
const elementDepth = (element: Element) => {
  let depth = 0;
  let current: Element | null = element.parentElement;
  while (current) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
};

export class SvgRuntimeRig {
  private readonly svg: SVGSVGElement;
  private readonly rig: CharacterRigV1;
  private readonly parts = new Map<string, RuntimePart>();
  private readonly slotContainers = new Map<string, SVGGElement>();
  private disposed = false;

  constructor(svg: SVGSVGElement, rig: CharacterRigV1) {
    this.svg = svg;
    this.rig = rig;
    try {
      this.build();
    } catch (error) {
      this.teardown();
      throw error;
    }
  }

  private build() {
    const character = this.svg.querySelector<SVGGElement>("#character");
    if (!character) throw new Error("正式素材缺少 character 图层");

    const sources = new Map<string, SVGGraphicsElement>();
    for (const definition of this.rig.parts) {
      const source = findUniqueSource(this.svg, definition);
      if (this.svg.querySelector(`[data-runtime-part="${definition.id}"]`)) {
        throw new Error(`Part ${definition.id} 已存在 runtime wrapper`);
      }
      sources.set(definition.id, source);
    }

    for (const slot of this.rig.renderSlots) {
      const container = document.createElementNS(SVG_NS, "g");
      container.id = `runtime-slot-${slot}`;
      container.dataset.runtimeSlot = slot;
      if (slot === "back") character.insertBefore(container, character.firstChild);
      else character.appendChild(container);
      this.slotContainers.set(slot, container);
    }

    for (const definition of this.rig.parts) {
      const source = sources.get(definition.id)!;
      const { procedural, interaction } = findPartLayers(source);
      const authored = document.createElementNS(SVG_NS, "g");
      authored.id = `${definition.id.replace(/_/g, "-")}-authored`;
      authored.dataset.runtimePart = definition.id;

      const parent = procedural.parentNode;
      if (!parent) throw new Error(`Part ${definition.id} 没有可包装的父节点`);
      parent.insertBefore(authored, procedural);
      authored.appendChild(procedural);

      const originalSourceTransform = source.getAttribute("transform");
      if (originalSourceTransform && !isIdentity(definition.bindMatrix)) {
        source.removeAttribute("transform");
      }
      authored.setAttribute("transform", matrixAttribute(definition.bindMatrix));

      const slotNode = interaction ?? authored;
      const originalSlotParent = slotNode.parentNode;
      if (!originalSlotParent) throw new Error(`Part ${definition.id} 没有 slot 父节点`);
      const originalSlotMarker = document.createComment(`runtime-slot:${definition.id}`);
      originalSlotParent.insertBefore(originalSlotMarker, slotNode);
      this.parts.set(definition.id, {
        definition,
        source,
        authored,
        slotNode,
        originalSlotParent,
        originalSlotMarker,
        originalSourceTransform,
        currentSlot: definition.defaultRenderSlot,
        worldAlignment: [1, 0, 0, 1, 0, 0],
        parentBindMatrix: [1, 0, 0, 1, 0, 0],
      });
    }

    const bindWorldMatrices = resolveAllPoses(new Map(), this.rig).worldMatrices;
    for (const [partId, part] of this.parts) {
      const bindWorld = bindWorldMatrices.get(partId);
      if (!bindWorld) throw new Error(`Part ${partId} 缺少 bind world matrix`);
      const inverseBindWorld = invert(bindWorld);
      if (!inverseBindWorld) throw new Error(`Part ${partId} 的 bind world matrix 不可逆`);
      const parent = part.authored.parentElement;
      if (!hasCtm(parent)) throw new Error(`Part ${partId} 的 wrapper 父节点不支持 CTM`);
      part.parentBindMatrix = getCtm(parent);
      // Preserve the artwork bind pose while decoupling semantic inheritance
      // from the source DOM ancestry and render-slot containers.
      part.worldAlignment = multiply(getCtm(part.authored), inverseBindWorld);
    }
  }

  applyFrame(clip: MotionClipV1, frame: number) {
    if (this.disposed) return;
    const pose = sampleMotionClip(clip, frame, this.rig);
    for (const runtimePart of this.parts.values()) {
      this.applyRenderSlot(
        runtimePart,
        pose.renderSlots.get(runtimePart.definition.id) ?? runtimePart.definition.defaultRenderSlot,
      );
    }

    const controlledParts = this.collectControlledParts(clip);
    this.projectWorldMatrices(
      resolveAllPoses(pose.transforms, this.rig).worldMatrices,
      controlledParts,
    );
    for (const [partId, value] of pose.transforms) {
      this.parts.get(partId)?.authored.setAttribute("opacity", String(value.opacity));
    }
  }

  private collectControlledParts(clip: MotionClipV1) {
    const controlled = new Set(clip.tracks.map((track) => track.partId));
    let changed = true;
    while (changed) {
      changed = false;
      for (const part of this.rig.parts) {
        if (part.logicalParentId && controlled.has(part.logicalParentId) && !controlled.has(part.id)) {
          controlled.add(part.id);
          changed = true;
        }
      }
    }
    return controlled;
  }

  private projectWorldMatrices(
    worldMatrices: Map<string, AffineMatrix>,
    controlledParts?: ReadonlySet<string>,
  ) {
    const partsInDomOrder = [...this.parts.values()]
      .sort((left, right) => elementDepth(left.authored) - elementDepth(right.authored));
    for (const part of partsInDomOrder) {
      if (controlledParts && !controlledParts.has(part.definition.id)) continue;
      const worldMatrix = worldMatrices.get(part.definition.id);
      if (!worldMatrix) continue;
      const inverseParent = invert(part.parentBindMatrix);
      if (!inverseParent) {
        throw new Error(`Part ${part.definition.id} 的 wrapper 父节点 bind CTM 不可逆`);
      }
      part.authored.setAttribute("transform", matrixAttribute(multiply(
        inverseParent,
        multiply(part.worldAlignment, worldMatrix),
      )));
    }
  }

  private applyRenderSlot(part: RuntimePart, slot: string) {
    if (slot === part.currentSlot) return;
    if (slot === part.definition.defaultRenderSlot) {
      this.restoreSlot(part);
    } else {
      const container = this.slotContainers.get(slot);
      if (!container) throw new Error(`未知 renderSlot: ${slot}`);
      container.appendChild(part.slotNode);
    }
    part.currentSlot = slot;
  }

  private restoreSlot(part: RuntimePart) {
    part.originalSlotParent.insertBefore(part.slotNode, part.originalSlotMarker.nextSibling);
  }

  restore() {
    if (this.disposed) return;
    for (const part of this.parts.values()) {
      part.authored.removeAttribute("opacity");
      if (part.currentSlot !== part.definition.defaultRenderSlot) {
        this.restoreSlot(part);
        part.currentSlot = part.definition.defaultRenderSlot;
      }
    }
    for (const part of this.parts.values()) {
      part.authored.setAttribute("transform", matrixAttribute(part.definition.bindMatrix));
    }
  }

  dispose() {
    if (this.disposed) return;
    try {
      this.restore();
    } finally {
      this.teardown();
    }
  }

  private teardown() {
    if (this.disposed) return;
    const partsInDomOrder = [...this.parts.values()]
      .sort((left, right) => elementDepth(right.authored) - elementDepth(left.authored));
    for (const part of partsInDomOrder) {
      if (part.slotNode.parentNode !== part.originalSlotParent) this.restoreSlot(part);
      const parent = part.authored.parentNode;
      if (parent) {
        while (part.authored.firstChild) {
          parent.insertBefore(part.authored.firstChild, part.authored);
        }
        part.authored.remove();
      }
      part.originalSlotMarker.remove();
      if (part.originalSourceTransform !== null) {
        part.source.setAttribute("transform", part.originalSourceTransform);
      }
    }
    for (const container of this.slotContainers.values()) container.remove();
    this.parts.clear();
    this.slotContainers.clear();
    this.disposed = true;
  }
}
