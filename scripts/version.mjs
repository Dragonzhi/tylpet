import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const checkOnly = process.argv.includes("--check");
const showOnly = process.argv.includes("--show");
const version = readFileSync(resolve(root, "VERSION"), "utf8").trim();
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!semverPattern.test(version)) {
  throw new Error(`VERSION 不是合法 SemVer：${version}`);
}

if (showOnly) {
  console.log(version);
  process.exit(0);
}

const mismatches = [];

function updateJson(path, mutate) {
  const absolutePath = resolve(root, path);
  const currentText = readFileSync(absolutePath, "utf8");
  const document = JSON.parse(currentText);
  mutate(document);
  const nextText = `${JSON.stringify(document, null, 2)}\n`;
  if (currentText.replace(/\r\n/g, "\n") !== nextText) {
    if (checkOnly) mismatches.push(path);
    else writeFileSync(absolutePath, nextText, "utf8");
  }
}

function updateText(path, mutate) {
  const absolutePath = resolve(root, path);
  const currentText = readFileSync(absolutePath, "utf8");
  const nextText = mutate(currentText);
  if (currentText !== nextText) {
    if (checkOnly) mismatches.push(path);
    else writeFileSync(absolutePath, nextText, "utf8");
  }
}

updateJson("package.json", (document) => {
  document.version = version;
});

updateJson("package-lock.json", (document) => {
  document.version = version;
  document.packages[""].version = version;
});

updateJson("src-tauri/tauri.conf.json", (document) => {
  document.version = version;
});

updateText("src-tauri/Cargo.toml", (text) =>
  text.replace(/(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/, `$1"${version}"`),
);

updateText("src-tauri/Cargo.lock", (text) => {
  const packagePattern = /(\[\[package\]\]\r?\nname = "tylpet"\r?\nversion = )"[^"]+"/;
  if (!packagePattern.test(text)) {
    if (checkOnly) mismatches.push("src-tauri/Cargo.lock（找不到 tylpet 包）");
    return text;
  }
  return text.replace(packagePattern, `$1"${version}"`);
});

if (checkOnly && mismatches.length > 0) {
  console.error(`版本 ${version} 尚未同步到：`);
  for (const path of [...new Set(mismatches)]) console.error(`- ${path}`);
  console.error("请运行 npm run version:sync。\n");
  process.exit(1);
}

console.log(`${checkOnly ? "版本检查通过" : "版本同步完成"}：${version}（tag: v${version}）`);
