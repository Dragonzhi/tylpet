import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const SVG_NS = "http://www.w3.org/2000/svg";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const characterDirectory = path.join(repositoryRoot, "src/assets/character/xiaoluobao");
const sourcePath = path.join(characterDirectory, "artwork.source.svg");
const outputPath = path.join(characterDirectory, "artwork.svg");
const rigPath = path.join(characterDirectory, "rig.v1.json");
const checkOnly = process.argv.includes("--check");

const [sourceText, currentOutput, rigText] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(outputPath, "utf8").catch(() => ""),
  readFile(rigPath, "utf8"),
]);

const rig = parseJson(rigText, "rig.v1.json");
const productionSvg = buildProductionSvg(sourceText, rig);
const fingerprint = sha256CanonicalText(productionSvg);
const nextRigText = replaceRigFingerprint(rigText, fingerprint);

if (checkOnly) {
  const problems = [];
  if (normalizeLineEndings(currentOutput) !== productionSvg) {
    problems.push("artwork.svg 不是 artwork.source.svg 的最新规范化产物");
  }
  if (normalizeLineEndings(rigText) !== nextRigText) {
    problems.push("rig.v1.json 的 artwork fingerprint 尚未同步");
  }
  if (problems.length > 0) {
    throw new Error(`${problems.join("；")}。请运行 npm run artwork:build`);
  }
  console.log(`Artwork check passed: ${fingerprint}`);
} else {
  await Promise.all([
    writeAtomic(outputPath, productionSvg),
    writeAtomic(rigPath, nextRigText),
  ]);
  console.log(`Generated ${path.relative(repositoryRoot, outputPath)}`);
  console.log(`Updated artwork fingerprint: ${fingerprint}`);
}

export function buildProductionSvg(source, rigDocument) {
  const dom = new JSDOM(source, { contentType: "image/svg+xml" });
  const { document } = dom.window;
  const root = document.documentElement;
  if (root.namespaceURI !== SVG_NS || root.localName !== "svg") {
    throw new Error("artwork.source.svg 根节点必须是 SVG");
  }

  for (const selector of ["script", "foreignObject", "metadata"]) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  for (const node of [...document.getElementsByTagNameNS(
    "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd",
    "namedview",
  )]) node.remove();

  root.removeAttribute("inkscape:version");
  root.removeAttribute("sodipodi:docname");
  root.removeAttribute("xml:space");
  root.removeAttribute("xmlns:svg");
  root.removeAttribute("xmlns:sodipodi");

  const elements = [...document.querySelectorAll("*")];
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name;
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        throw new Error(`SVG 不允许事件属性：${name}`);
      }
      if (name.startsWith("inkscape:export-")
        || name.startsWith("inkscape:transform-center-")
        || name.startsWith("sodipodi:")) {
        element.removeAttribute(name);
        continue;
      }
      if ((name === "href" || name === "xlink:href")
        && value !== ""
        && !value.startsWith("#")
        && !value.startsWith("data:")) {
        throw new Error(`SVG 不允许外部资源：${value}`);
      }
      if (/url\(\s*["']?(?:https?:|file:)/iu.test(value)) {
        throw new Error(`SVG 不允许外部 URL：${name}`);
      }
    }
  }

  const labels = new Map();
  const ids = new Set();
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (id) {
      if (ids.has(id)) throw new Error(`SVG 存在重复 id：${id}`);
      ids.add(id);
    }
    const label = element.getAttributeNS(INKSCAPE_NS, "label");
    if (!label) continue;
    if (labels.has(label)) throw new Error(`SVG 存在重复 inkscape:label：${label}`);
    labels.set(label, element);
  }

  validateViewBox(root, rigDocument?.artwork?.viewBox);
  for (const part of rigDocument?.parts ?? []) {
    if (part?.sourceBinding?.kind === "inkscapeLabel") {
      requireLabel(labels, part.sourceBinding.value, `rig part ${part.id}`);
    }
  }

  const mouth = requireLabel(labels, "mouth", "M14 mouth root");
  const mouthClosed = requireLabel(labels, "mouth_closed", "M14 closed mouth");
  const mouthOpen = requireLabel(labels, "mouth_open", "M14 open mouth");
  if (!mouth.contains(mouthClosed) || !mouth.contains(mouthOpen)) {
    throw new Error("mouth_closed 和 mouth_open 必须位于 mouth 图层内部");
  }
  if (isDisplayNone(mouthClosed)) {
    throw new Error("mouth_closed 必须默认显示");
  }
  if (!isDisplayNone(mouthOpen)) {
    throw new Error("mouth_open 必须默认隐藏（display:none）");
  }

  for (const [label, element] of labels) {
    const semanticId = label.replaceAll("_", "-");
    element.setAttribute("id", semanticId);
    element.setAttribute("data-part", label);
  }
  const productionIds = new Set();
  for (const element of document.querySelectorAll("[id]")) {
    const id = element.getAttribute("id");
    if (productionIds.has(id)) throw new Error(`语义 ID 与现有 SVG ID 冲突：${id}`);
    productionIds.add(id);
  }

  removeWhitespaceOnlyNodes(root);
  const serialized = new dom.window.XMLSerializer().serializeToString(root);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized.replaceAll("><", ">\n<")}\n`;
}

function requireLabel(labels, label, purpose) {
  const element = labels.get(label);
  if (!element) throw new Error(`${purpose} 缺少 inkscape:label="${label}"`);
  return element;
}

function validateViewBox(root, expected) {
  const actual = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (actual.length !== 4 || actual.some((value) => !Number.isFinite(value))) {
    throw new Error("SVG viewBox 必须包含四个有限数值");
  }
  if (!Array.isArray(expected)
    || expected.length !== 4
    || actual.some((value, index) => Math.abs(value - expected[index]) > 1e-6)) {
    throw new Error(`SVG viewBox 与 rig 不一致：${actual.join(" ")}`);
  }
}

function isDisplayNone(element) {
  return element.getAttribute("display") === "none"
    || /(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/iu.test(element.getAttribute("style") ?? "");
}

function removeWhitespaceOnlyNodes(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3 && child.nodeValue?.trim() === "") {
      child.remove();
    } else {
      removeWhitespaceOnlyNodes(child);
    }
  }
}

function replaceRigFingerprint(text, fingerprint) {
  const normalized = normalizeLineEndings(text);
  const pattern = /("fingerprint"\s*:\s*")[^"]+(")/u;
  if (!pattern.test(normalized)) throw new Error("rig.v1.json 缺少 artwork fingerprint");
  return `${normalized.replace(pattern, `$1${fingerprint}$2`).trimEnd()}\n`;
}

function sha256CanonicalText(text) {
  return `sha256:${createHash("sha256").update(normalizeLineEndings(text).normalize("NFC"), "utf8").digest("hex")}`;
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n?/gu, "\n");
}

function parseJson(text, name) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeAtomic(target, content) {
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}
