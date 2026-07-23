import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = readFileSync(resolve(root, "VERSION"), "utf8").trim();
const tag = `v${version}`;

execFileSync(process.execPath, [resolve(root, "scripts/version.mjs"), "--check"], {
  cwd: root,
  stdio: "inherit",
});

const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
if (status) throw new Error("工作区不干净：请先检查并提交发布改动，再创建 tag");

const existing = execFileSync("git", ["tag", "--list", tag], { cwd: root, encoding: "utf8" }).trim();
if (existing) throw new Error(`tag 已存在：${tag}`);

const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog)) {
  throw new Error(`CHANGELOG.md 尚未为 ${version} 填写 YYYY-MM-DD 发布日期`);
}

execFileSync("git", ["tag", "-a", tag, "-m", `绨络 Tylpet ${version}`], {
  cwd: root,
  stdio: "inherit",
});

console.log(`已创建 ${tag}。确认后执行：git push origin ${tag}`);
