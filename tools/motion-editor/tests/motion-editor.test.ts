import { describe, it, expect } from "vitest";
import { inspectSvgForImport } from "../src/import/inspectSvgForImport";

// =============================================================================
// P0-B: 诊断测试 (unified inspectSvgForImport)
// =============================================================================

describe("P0-B 诊断", () => {
  it("拒绝 <script> 节点", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.hasError).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "error" && d.message.includes("script"))).toBe(true);
  });

  it("拒绝 <foreignObject> 节点", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject id="fo"><div xmlns="http://www.w3.org/1999/xhtml"><b>test</b></div></foreignObject></svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.hasError).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "error" && d.message.toLowerCase().includes("foreignobject"))).toBe(true);
  });

  it("拒绝 onclick 等事件属性", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g onclick="alert(1)" id="test"/></svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.hasError).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "error" && d.message.includes("on"))).toBe(true);
  });

  it("检测重复 ID", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle id="a" cx="1" cy="1" r="1"/><rect id="a" x="1" y="1" width="1" height="1"/></svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.hasError).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes("重复 ID"))).toBe(true);
  });

  it("检测孤立 pivot（pivot 存在但无对应部件）", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <ellipse inkscape:label="pivot_nonexistent_part" cx="10" cy="10" rx="1" ry="1"/>
</svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.diagnostics.some((d) => d.message.includes("孤立 pivot"))).toBe(true);
  });

  it("检测部件缺少 pivot", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <g inkscape:label="arm_left" id="arm_left"/>
</svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.diagnostics.some((d) => d.message.includes("缺少 pivot 标记"))).toBe(true);
  });

  it("拒绝 http: 外部引用（error 级别）", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.com/bad.png"/></svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.hasError).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes("http:"))).toBe(true);
  });
});

// =============================================================================
// P0-C: 部件检测测试 (via inspectSvgForImport)
// =============================================================================

describe("P0-C 部件检测", () => {
  it("从 SVG 发现语义部件", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <g inkscape:label="arm_left" id="arm_left"/>
  <g inkscape:label="arm_right" id="arm_right"/>
  <g inkscape:label="head" id="head"/>
</svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.parts).toHaveLength(3);
    const ids = result.parts.map((p) => p.partId).sort();
    expect(ids).toEqual(["arm_left", "arm_right", "head"]);
  });

  it("排除容器 label (character)", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <g inkscape:label="character" id="char"/>
  <g inkscape:label="arm_left" id="arm_left"/>
</svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].partId).toBe("arm_left");
  });

  it("排除容器 label (hair_accessory)", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <g inkscape:label="hair_accessory" id="ha"/>
  <g inkscape:label="arm_left" id="arm_left"/>
</svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].partId).toBe("arm_left");
  });

  it("排除 pivot_* 前缀 label", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <ellipse inkscape:label="pivot_arm_left" cx="10" cy="10" rx="1" ry="1" id="p1"/>
  <g inkscape:label="arm_left" id="arm_left"/>
</svg>`;
    const result = inspectSvgForImport(svg);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].partId).toBe("arm_left");
    expect(result.pivotMap.has("arm_left")).toBe(true);
    const pivot = result.pivotMap.get("arm_left")!;
    expect(pivot.x).toBe(10);
    expect(pivot.y).toBe(10);
  });

  it("读取 pivot 坐标", () => {
    const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape">
  <ellipse inkscape:label="pivot_arm_right" cx="25.5" cy="33.7" rx="1" ry="1" id="par"/>
  <g inkscape:label="arm_right" id="arm_right"/>
</svg>`;
    const result = inspectSvgForImport(svg);
    const pivot = result.pivotMap.get("arm_right")!;
    expect(pivot.x).toBeCloseTo(25.5);
    expect(pivot.y).toBeCloseTo(33.7);
    expect(pivot.sourceElementId).toBe("par");
  });
});
