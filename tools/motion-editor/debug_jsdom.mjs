import { JSDOM } from "jsdom";

const svg1 =
  '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>html</div></foreignObject></svg>';
const svg2 =
  '<svg xmlns="http://www.w3.org/2000/svg"><g onclick="alert(1)"/></svg>';

console.log("=== foreignObject test ===");
const dom1 = new JSDOM(svg1, { contentType: "image/svg+xml" });
const doc1 = dom1.window.document;
const all1 = doc1.querySelectorAll("*");
all1.forEach((e) =>
  console.log(
    "  tag:",
    e.tagName,
    "| attrs:",
    [...e.attributes].map((a) => a.name).join(",")
  )
);

console.log("=== onclick test ===");
const dom2 = new JSDOM(svg2, { contentType: "image/svg+xml" });
const doc2 = dom2.window.document;
const all2 = doc2.querySelectorAll("*");
all2.forEach((e) =>
  console.log(
    "  tag:",
    e.tagName,
    "| attrs:",
    [...e.attributes].map((a) => a.name + "=" + a.value).join(",")
  )
);

// Test with DOMParser
const parser = new DOMParser();
const docp1 = parser.parseFromString(svg1, "image/svg+xml");
console.log("=== DOMParser foreignObject ===");
const allp1 = docp1.querySelectorAll("*");
allp1.forEach((e) =>
  console.log(
    "  tag:",
    e.tagName,
    "| attrs:",
    [...e.attributes].map((a) => a.name).join(",")
  )
);

const docp2 = parser.parseFromString(svg2, "image/svg+xml");
console.log("=== DOMParser onclick ===");
const allp2 = docp2.querySelectorAll("*");
allp2.forEach((e) =>
  console.log(
    "  tag:",
    e.tagName,
    "| attrs:",
    [...e.attributes].map((a) => a.name + "=" + a.value).join(",")
  )
);
