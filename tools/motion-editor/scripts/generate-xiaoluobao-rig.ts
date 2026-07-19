import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { serializeRig } from "@ltypet/character-motion";
import { inspectSvgForImport } from "../src/import/inspectSvgForImport";
import { buildRigFromImport } from "../src/project/v1Project";
import type { ImportResult, ImportedPartRef } from "../src/svgcanvas/SvgCanvasAdapter";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const assetsDirectory = resolve(repositoryRoot, "src/assets");
const artworkFile = readdirSync(assetsDirectory).find((name) => name.endsWith(".glax.svg"));
if (!artworkFile) throw new Error("未找到 .glax.svg 样例素材");

const artworkPath = resolve(assetsDirectory, artworkFile);
const source = readFileSync(artworkPath, "utf8");
const canonical = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").normalize("NFC");
const fingerprint = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;

const dom = new JSDOM(source, { contentType: "image/svg+xml" });
globalThis.DOMParser = dom.window.DOMParser;
const inspection = inspectSvgForImport(source);
if (inspection.hasError) {
  throw new Error(inspection.diagnostics.map((item) => item.message).join("\n"));
}

const root = dom.window.document.documentElement;
if (root.querySelector("[transform]")) {
  throw new Error("素材包含 transform；请通过浏览器 adapter 导出 rig，避免离线生成器猜测 CTM");
}

const viewBoxValues = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
if (!viewBoxValues || viewBoxValues.length !== 4 || viewBoxValues.some((value: number) => !Number.isFinite(value))) {
  throw new Error("素材缺少合法 viewBox");
}

const parts: ImportedPartRef[] = inspection.parts.map((part) => {
  const element = dom.window.document.getElementById(part.sourceElementId);
  if (!(element instanceof dom.window.SVGElement)) {
    throw new Error(`找不到部件 ${part.partId}`);
  }
  return {
    ...part,
    element: element as unknown as SVGElement,
    bindMatrix: [1, 0, 0, 1, 0, 0],
    originalTransform: null,
      originalOpacity: element.getAttribute("opacity"),
      originalDisplay: element.getAttribute("display"),
      sourceOrder: 0,
      originalParent: element.parentNode,
      originalNextSibling: element.nextSibling,
  };
});

const imported: ImportResult = {
  parts,
  pivotLocal: new Map(
    Array.from(inspection.pivotMap, ([partId, pivot]) => [partId, { x: pivot.x, y: pivot.y }]),
  ),
  viewBox: viewBoxValues as [number, number, number, number],
  diagnostics: inspection.diagnostics,
};
const rig = buildRigFromImport(imported, { source: artworkFile, fingerprint });
const output = resolve(repositoryRoot, "packages/character-motion/fixtures/valid/xiaoluobao.rig.v1.json");
writeFileSync(output, serializeRig(rig), "utf8");
console.log(`已生成 ${output}`);
console.log(`${rig.parts.length} parts, ${imported.pivotLocal.size} pivots, ${fingerprint}`);
