# GitFlow 分支模式

## 分支总览

```
feature/*  ──► dev ──► release/* ──► main (tag)
hotfix/*  ────────────────────────┘
```

| 分支 | 来源 | 去向 | 说明 |
|---|---|---|---|
| `main` | `release/*`, `hotfix/*` | 发布 tag | 强保护，永远可构建 |
| `dev` | `feature/*` PR | `release/*` | 集成与 QA |
| `feature/*` | `dev` | PR → `dev` | 短命，合即删 |
| `release/*` | `dev` | PR → `main` | 只改版本号和修阻塞 bug |
| `hotfix/*` | `main` | PR → `main` | 紧急修复，再 cherry-pick → `dev` |

---

## 日常开发

```powershell
# 开始功能
git checkout dev && git pull origin dev
git checkout -b feature/M16-描述

# 开发提交
git add .
git commit -m "feat(模块): 描述"

# 定期同步 dev（避免长期偏离）
git fetch origin dev
git rebase origin/dev

# 推送并开 PR（feature/* → dev）
git push -u origin feature/M16-描述
```

PR 合并方式：**Squash and Merge**，合后立即删除 feature 分支。

---

## 发布流程

```powershell
# 1. dev 验证通过后切 release 分支
git checkout dev && git pull origin dev
git checkout -b release/v0.2.0

# 2. 在 release/* 上只做：同步版本号 + 更新 CHANGELOG + 修阻塞 bug
#    运行 scripts/version.mjs 同步 VERSION → package.json / Cargo.toml / tauri.conf.json

# 3. 打 tag
git tag -a v0.2.0 -m "release: 绨络 Tylpet v0.2.0"

# 4. 合入 main 并推送
git checkout main
git merge --no-ff release/v0.2.0
git push origin main v0.2.0

# 5. GitHub 上创建 Release（基于 tag v0.2.0）

# 6. 清理
git branch -d release/v0.2.0
git push origin --delete release/v0.2.0
```

---

## 热修复流程

```powershell
git checkout main && git pull origin main
git checkout -b hotfix/v0.1.1-fix-描述
git commit -m "fix(模块): 描述"
git tag -a v0.1.1 -m "hotfix: 描述"

git checkout main
git merge --no-ff hotfix/v0.1.1-fix-描述
git push origin main v0.1.1

# 同步修复到 dev
git checkout dev
git cherry-pick <commit-sha>
git push origin dev

git branch -d hotfix/v0.1.1-fix-描述
git push origin --delete hotfix/v0.1.1-fix-描述
```

---

## 分支命名规范

| 类型 | 格式 | 示例 |
|---|---|---|
| 功能 | `feature/描述` | `feature/chat-window` |
| 修复 | `fix/描述` | `fix/tray-icon-crash` |
| 发布 | `release/vx.y.z` | `release/v0.2.0` |
| 热修 | `hotfix/vx.y.z-描述` | `hotfix/v0.1.1-fix-tray` |

---

## 验证清单

合入 dev 前：
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run artwork:check`（涉及素材时）

合入 main 前（release 阶段追加）：
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `git diff --check`
- [ ] `npm run tauri dev` 真实窗口验证

---

## 版本号同步

`VERSION` 是唯一版本源。发布前运行：

```powershell
npm run version:sync   # 同步到 package.json / Cargo.toml / tauri.conf.json / package-lock.json / Cargo.lock
```

三处版本号必须与 Git tag 完全一致。

---

## CI/CD

GitHub Actions 工作流位于 `.github/workflows/`，分支和 tag 推送时自动触发：

| 工作流 | 触发条件 | 做什么 |
|---|---|---|
| `ci.yml` | PR 或 push 到 `dev` / `main` | npm test/build、Rust check/test/fmt、`version:check`、`git diff --check`，覆盖 root 和 motion-editor |
| `main-build.yml` | push 到 `main` | 完整检查 + 构建 NSIS 安装包，上传为 Actions Artifact（30 天），不创建 Release |
| `release.yml` | 推送 `v*` tag | 完整检查 + `release:check` + 构建 NSIS + 生成 `SHA256SUMS.txt` + 自动创建 GitHub Release；版本含 `-` 时标记 prerelease |
| `release-animation-studio.yml` | 推送 `animation-studio-v*` tag | motion-editor 独立构建 + 自动创建 GitHub Release |

**CHANGELOG** 由 release 分支人工维护，CI 不自动修改。

首次推送后到 GitHub **Actions** 标签页观察运行结果。`release-check.mjs` 中的 `docs/Mxx-xxx.md` 验收报告路径在里程碑演进时需同步更新。
