// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  multiply,
  type AffineMatrix,
  type CharacterRigV1,
  type MotionClipV1,
} from "@ltypet/character-motion";
import { SvgRuntimeRig } from "./SvgRuntimeRig";

const SVG_NS = "http://www.w3.org/2000/svg";
const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

const parseMatrix = (value: string | null): AffineMatrix => {
  if (!value) return IDENTITY;
  const match = /^matrix\(([^)]+)\)$/.exec(value);
  if (!match) throw new Error(`测试 CTM 不支持 transform: ${value}`);
  const values = match[1].trim().split(/[\s,]+/).map(Number);
  if (values.length !== 6 || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`无效测试矩阵: ${value}`);
  }
  return values as AffineMatrix;
};

const matrixLike = (matrix: AffineMatrix): DOMMatrix => ({
  a: matrix[0], b: matrix[1], c: matrix[2],
  d: matrix[3], e: matrix[4], f: matrix[5],
}) as DOMMatrix;

const getElementCtm = (element: Element): AffineMatrix => {
  const ancestors: Element[] = [];
  let current: Element | null = element;
  while (current?.namespaceURI === SVG_NS) {
    ancestors.unshift(current);
    current = current.parentElement;
  }
  return ancestors.reduce(
    (world, ancestor) => multiply(world, parseMatrix(ancestor.getAttribute("transform"))),
    IDENTITY,
  );
};

type CtmPrototype = { getCTM?: (this: Element) => DOMMatrix | null };
const svgPrototype = SVGElement.prototype as unknown as CtmPrototype;
let originalGetCtm: CtmPrototype["getCTM"];

beforeAll(() => {
  originalGetCtm = svgPrototype.getCTM;
  svgPrototype.getCTM = function getCTM() {
    return matrixLike(getElementCtm(this));
  };
});

afterAll(() => {
  if (originalGetCtm) svgPrototype.getCTM = originalGetCtm;
  else delete svgPrototype.getCTM;
});

const rig: CharacterRigV1 = {
  schemaVersion: 1,
  rigId: "dom-rig",
  artwork: { source: "fixture.svg", fingerprint: "test", viewBox: [0, 0, 100, 100] },
  renderSlots: ["back", "body", "front"],
  parts: [
    {
      id: "semantic_parent",
      sourceBinding: { kind: "elementId", value: "source-parent" },
      logicalParentId: null,
      defaultRenderSlot: "body",
      pivot: { x: 0, y: 0, space: "partLocal" },
      bindMatrix: IDENTITY,
    },
    {
      id: "semantic_child",
      sourceBinding: { kind: "dataPart", value: "bound-child" },
      logicalParentId: "semantic_parent",
      defaultRenderSlot: "body",
      pivot: { x: 0, y: 0, space: "partLocal" },
      bindMatrix: [1, 0, 0, 1, 10, 0],
    },
    {
      id: "semantic_accent",
      sourceBinding: { kind: "inkscapeLabel", value: "bound_accent" },
      logicalParentId: null,
      defaultRenderSlot: "front",
      pivot: { x: 0, y: 0, space: "partLocal" },
      bindMatrix: IDENTITY,
    },
  ],
};

const clip: MotionClipV1 = {
  id: "hierarchy",
  fps: 30,
  durationFrames: 1,
  loop: "none",
  events: [],
  tracks: [
    { partId: "semantic_parent", keyframes: [{ frame: 0, values: { x: 3, opacity: 0.5 } }] },
    { partId: "semantic_child", keyframes: [{ frame: 0, values: { x: 2, renderSlot: "front" } }] },
  ],
};

const createSvg = () => {
  document.body.innerHTML = `
    <svg xmlns="${SVG_NS}" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
      <g id="character">
        <g id="before" />
        <g id="source-parent"><path id="parent-path" /></g>
        <g data-part="bound-child" transform="matrix(1 0 0 1 10 0)"><path id="child-path" /></g>
        <g inkscape:label="bound_accent"><path id="accent-path" /></g>
        <g id="after" />
      </g>
    </svg>`;
  return document.querySelector("svg") as unknown as SVGSVGElement;
};

const getWrapper = (svg: SVGSVGElement, partId: string) =>
  svg.querySelector(`[data-runtime-part="${partId}"]`) as unknown as SVGGElement;

const expectTranslation = (element: Element, x: number, y = 0) => {
  const matrix = getElementCtm(element);
  expect(matrix[4]).toBeCloseTo(x, 8);
  expect(matrix[5]).toBeCloseTo(y, 8);
};


describe("SvgRuntimeRig DOM 投影", () => {
  it("按三种 source binding 包装且保持 bind pose", () => {
    const svg = createSvg();
    const runtime = new SvgRuntimeRig(svg, rig);
    expect(getWrapper(svg, "semantic_parent").contains(svg.querySelector("#parent-path"))).toBe(true);
    expect(getWrapper(svg, "semantic_child").contains(svg.querySelector("#child-path"))).toBe(true);
    expect(getWrapper(svg, "semantic_accent").contains(svg.querySelector("#accent-path"))).toBe(true);
    expectTranslation(getWrapper(svg, "semantic_parent"), 0);
    expectTranslation(getWrapper(svg, "semantic_child"), 10);
    runtime.dispose();
  });

  it("保持现有扁平 rig 的独立局部动作语义", () => {
    const svg = createSvg();
    const flatRig = structuredClone(rig);
    flatRig.parts.forEach((part) => { part.logicalParentId = null; });
    const runtime = new SvgRuntimeRig(svg, flatRig);
    runtime.applyFrame(clip, 0);
    expectTranslation(getWrapper(svg, "semantic_parent"), 3);
    expectTranslation(getWrapper(svg, "semantic_child"), 12);
    runtime.dispose();
  });

  it("logical parent 驱动子节点且 render slot 不参与逻辑继承", () => {
    const svg = createSvg();
    const runtime = new SvgRuntimeRig(svg, rig);
    runtime.applyFrame(clip, 0);

    const parent = getWrapper(svg, "semantic_parent");
    const child = getWrapper(svg, "semantic_child");
    expectTranslation(parent, 3);
    expectTranslation(child, 15);
    expect(parent.getAttribute("opacity")).toBe("0.5");
    expect(child.parentElement?.dataset.runtimeSlot).toBe("front");
    expect(parent.contains(child)).toBe(false);

    runtime.restore();
    expectTranslation(parent, 0);
    expectTranslation(child, 10);
    expect(parent.hasAttribute("opacity")).toBe(false);
    expect(child.parentElement?.id).toBe("character");
    runtime.dispose();
  });

  it("dispose 完整恢复源 transform、DOM 顺序并支持连续双挂载", () => {
    const svg = createSvg();
    const character = svg.querySelector("#character")!;
    const originalMarkup = character.innerHTML;

    const first = new SvgRuntimeRig(svg, rig);
    first.applyFrame(clip, 0);
    first.dispose();
    first.dispose();
    expect(character.innerHTML).toBe(originalMarkup);

    const second = new SvgRuntimeRig(svg, rig);
    expect(svg.querySelectorAll("[data-runtime-part]")).toHaveLength(3);
    second.dispose();
    expect(character.innerHTML).toBe(originalMarkup);
  });

  it("binding 失败会回滚已创建的 slot 容器", () => {
    const svg = createSvg();
    const badRig = structuredClone(rig);
    badRig.parts[0].sourceBinding.value = "missing";
    const originalMarkup = svg.querySelector("#character")!.innerHTML;

    expect(() => new SvgRuntimeRig(svg, badRig)).toThrow("sourceBinding 命中 0 个节点");
    expect(svg.querySelector("#character")!.innerHTML).toBe(originalMarkup);
    expect(svg.querySelectorAll("[data-runtime-slot]")).toHaveLength(0);
  });
});
