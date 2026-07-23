import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readText = (path) => readFileSync(resolve(root, path), "utf8");
const readJson = (path) => JSON.parse(readText(path));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = readText("src-tauri/Cargo.toml");
const appSource = readText("src/App.tsx");
const canonicalVersion = readText("VERSION").trim();

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = [packageJson.version, packageLock.version, tauriConfig.version, cargoVersion];

check(versions.every((version) => version === canonicalVersion), `版本号未与 VERSION=${canonicalVersion} 同步：${versions.join(" / ")}`);
check(packageJson.name === "tylpet" && packageLock.name === "tylpet", "根 npm 包名必须为 tylpet");
check(packageJson.private === true, "根 npm 包必须保持 private，避免误发布到 npm");
check(tauriConfig.productName === "绨络", "安装包 productName 不是“绨络”");
check(tauriConfig.identifier === "com.tauri-app.ltypet", "应用标识符发生变化，会导致现有用户数据目录迁移");
check(Array.isArray(tauriConfig.bundle?.targets) && tauriConfig.bundle.targets.includes("nsis"), "预览版必须生成 NSIS 安装包");
check(typeof tauriConfig.app?.security?.csp === "string" && tauriConfig.app.security.csp.length > 0, "生产 CSP 不能为 null");
check(!tauriConfig.app?.security?.csp?.includes("unsafe-eval"), "生产 CSP 不得允许 unsafe-eval");
check(!("@tauri-apps/plugin-opener" in (packageJson.dependencies ?? {})), "未使用的 opener 前端依赖仍存在");
check(!cargoToml.includes("tauri-plugin-opener"), "未使用的 opener Rust 依赖仍存在");
check(appSource.includes("import.meta.env.DEV") && appSource.includes("DebugConsole"), "动作调试控制台缺少明确的 DEV 构建门");

const requiredFiles = [
  "README.md",
  "CHANGELOG.md",
  "docs/M16-P0预览发布验收报告.md",
  "src-tauri/icons/app-icon-source.svg",
  "src-tauri/icons/icon.ico",
];
for (const path of requiredFiles) check(existsSync(resolve(root, path)), `缺少发布文件：${path}`);

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const forbiddenNames = new Set([".env", "secrets.json", "settings.json", "memory.v1.json", "timer-state.json"]);
for (const path of tracked) {
  check(!forbiddenNames.has(basename(path).toLowerCase()), `疑似运行时秘密或用户数据被 Git 跟踪：${path}`);
}

const ignoredDirectories = new Set([".git", "node_modules", "target", "dist"]);
const workingTreeFiles = [];
const directories = [root];
while (directories.length > 0) {
  const directory = directories.pop();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) directories.push(path);
    if (entry.isFile()) workingTreeFiles.push(path);
  }
}
for (const path of workingTreeFiles) {
  check(!forbiddenNames.has(basename(path).toLowerCase()), `工作区存在疑似运行时秘密或用户数据文件：${path}`);
}

if (existsSync(resolve(root, "dist"))) {
  const pending = [resolve(root, "dist")];
  let debugTextFound = false;
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      if (entry.isFile() && /\.(?:html|js|css)$/.test(entry.name)) {
        debugTextFound ||= readFileSync(path, "utf8").includes("动作控制台");
      }
    }
  }
  check(!debugTextFound, "生产 dist 中仍包含动作调试控制台文案");
}

if (failures.length > 0) {
  console.error("发布检查失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`发布静态检查通过：绨络 Tylpet ${canonicalVersion}，${tracked.length} 个已跟踪文件未发现运行时秘密文件。`);
