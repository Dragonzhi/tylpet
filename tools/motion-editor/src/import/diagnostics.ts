/**
 * SVG 安全导入诊断。
 * 使用 DOMParser 解析 SVG 文本，返回结构化诊断信息。
 */

import type { Diagnostic } from "../svgcanvas/SvgCanvasAdapter";

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 对 SVG 文本执行一系列安全检查与诊断。
 *
 * 检查项包括：
 * - XML 解析错误
 * - 危险节点（script、foreignObject、事件属性）
 * - 外部引用
 * - 重复 ID
 * - 孤立 pivot 标记
 * - 部件缺少 pivot
 * - 无法求逆的 matrix
 * - 无 ID 的元素
 */
export function runDiagnostics(svgText: string): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // ---- 1. XML 解析 ----
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    diags.push({
      severity: "error",
      message: `XML 解析错误: ${parseError.textContent?.slice(0, 200) ?? "未知错误"}`,
    });
    return diags;
  }

  const svgRoot = doc.documentElement;
  if (!svgRoot || svgRoot.tagName.toLowerCase() !== "svg") {
    diags.push({
      severity: "error",
      message: "根元素不是 <svg>",
    });
    return diags;
  }

  const allElements = svgRoot.querySelectorAll("*");

  // ---- 2. 危险节点（程序化检查，兼容不同 DOM 实现） ----
  const dangerous: Element[] = [];
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "foreignobject") {
      dangerous.push(el);
      continue;
    }
    // Check for on* event handler attributes
    for (let i = 0; i < el.attributes.length; i++) {
      const attrName = el.attributes[i].name;
      if (attrName.startsWith("on")) {
        dangerous.push(el);
        break;
      }
    }
  }

  for (const n of dangerous) {
    const tag = n.tagName.toLowerCase();
    const id = n.getAttribute("id") || "无ID";
    diags.push({
      severity: "error",
      message: `危险节点: <${tag}> (#${id})`,
    });
  }

  // ---- 3. 外部引用 ----
  for (const el of allElements) {
    const href =
      el.getAttribute("href") ||
      el.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
      "";
    if (href.startsWith("http") || href.startsWith("//")) {
      diags.push({
        severity: "warn",
        message: `外部引用: ${href}`,
      });
    }
  }

  // ---- 4. 重复 ID ----
  const idCount = new Map<string, number>();
  for (const el of allElements) {
    const id = el.getAttribute("id");
    if (id) {
      idCount.set(id, (idCount.get(id) ?? 0) + 1);
    }
  }
  idCount.forEach((count, id) => {
    if (count > 1) {
      diags.push({
        severity: "warn",
        message: `重复 ID: "${id}" 出现 ${count} 次`,
      });
    }
  });

  // ---- 5. pivot 与部件对应关系 ----
  const parts = new Set<string>();
  const pivots = new Set<string>();

  for (const el of allElements) {
    const label = el.getAttribute("inkscape:label");
    if (!label) continue;

    if (label.startsWith("pivot_")) {
      pivots.add(label.replace(/^pivot_/, ""));
    } else if (label !== "character" && label !== "hair_accessory") {
      parts.add(label);
    }
  }

  pivots.forEach((p) => {
    if (!parts.has(p)) {
      diags.push({
        severity: "warn",
        message: `孤立 pivot: pivot_${p} 存在但无对应部件 "${p}"`,
      });
    }
  });

  parts.forEach((p) => {
    if (!pivots.has(p)) {
      diags.push({
        severity: "info",
        message: `部件 "${p}" 缺少 pivot 标记`,
      });
    }
  });

  // ---- 6. 无法求逆的 matrix (det ≈ 0) ----
  for (const el of allElements) {
    const transform = el.getAttribute("transform") ?? "";
    const matrixMatch = transform.match(/matrix\s*\(\s*([^)]+)\s*\)/);
    if (matrixMatch) {
      const values = matrixMatch[1]
        .split(/[\s,]+/)
        .map((s) => parseFloat(s.trim()))
        .filter((v) => !isNaN(v));
      if (values.length >= 6) {
        const [a, b, c, d] = values;
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-10) {
          diags.push({
            severity: "error",
            message: `无法求逆的 matrix: transform="${transform}"`,
          });
        }
      }
    }
  }

  // ---- 7. 无 ID 的元素 ----
  const skipTags = new Set(["svg", "defs", "namedview", "page"]);
  let noIdCount = 0;
  for (const el of allElements) {
    if (!el.getAttribute("id") && !skipTags.has(el.tagName.toLowerCase())) {
      noIdCount++;
    }
  }
  if (noIdCount > 0) {
    diags.push({
      severity: "info",
      message: `${noIdCount} 个元素缺少 id 属性`,
    });
  }

  return diags;
}
