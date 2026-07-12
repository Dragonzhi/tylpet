# 天依桌宠 — Project Handover

> 交接日期：2026-07-12
> 项目路径：`D:\WorkProject\ltypet\ltypet\`
> 初始搭建：Hanako（HanaAgent）→ 交接给 Codex CLI 继续开发

---

## 项目愿景

一只坐在桌面角落的洛天依。她能跟你聊天（LLM），能开番茄钟一起专注，会感知你在写代码/听歌/摸鱼，并做出相应反应。她有自己的性格，你们的关系会随着相处慢慢加深。

对标产品：Clawd on Desk（技术架构）+ 放松时光：与你共享Lo-Fi Story（产品气质）+ FL Studio 水果娘（角色灵魂）

---

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | **Tauri v2** | Rust 后端 + 系统 WebView，5MB 二进制 |
| 前端框架 | **React 19 + TypeScript 5.8** | 以 `package.json` 与实际安装版本为准 |
| 构建工具 | **Vite 7** | 以 `package.json` 与实际安装版本为准 |
| 角色渲染 | **SVG (内联)** | 纯矢量，代码可控，无额外依赖 |
| Rust 版本 | **1.97.0** | |
| Node 版本 | **22.20.0** | |

---

## 当前状态（v0.1.0）

### 已实现
- [x] Tauri v2 透明无边框窗口（AlwaysOnTop + skipTaskbar + 点击穿透）
- [x] SVG 临时天依矢量角色（头/身/发/蝴蝶结/四肢独立部件）
- [x] 状态机骨架（6 种状态：idle / blink / listen / speak / sleep / drag）
- [x] 呼吸动画（身体随正弦波上下浮动 + 手臂摆动）
- [x] 随机眨眼（3-5 秒间隔）
- [x] 鼠标拖拽（任意位置拖放，但是窗口小，不能拖到窗口外）
- [x] Git 初始化 + 首次提交
- [x] `.gitignore` 覆盖 target/node_modules/dist
- [x] cargo 中科大镜像源配置

### 待实现（按优先级）
- [ ] SVG 角色形象细化（画得更像天依）
- [ ] 更多动画状态（听歌律动、打哈欠、伸懒腰、跟随鼠标视线）
- [ ] 窗口吸附（拖到屏幕边缘吸附/贴任务栏）
- [ ] 点击交互（单击切换表情、双击弹出菜单）
- [ ] 粒子特效（音符飘动、星光）
- [ ] 右键菜单（设置、切换模式、退出）
- [ ] 状态持久化（窗口位置、偏好设置）
- [ ] Rust 后端（番茄钟计时器、系统音频检测、前台窗口感知）
- [ ] LLM 对话接入（双击天依打开聊天窗）
- [ ] Lo-Fi 背景音乐 + 环境音
- [ ] 羁绊/好感度系统

---

## 项目结构

```
D:\WorkProject\ltypet\ltypet\
│
├── index.html                 # 入口 HTML（透明背景）
├── package.json               # npm 依赖
├── vite.config.ts             # Vite 配置
├── tsconfig.json              # TypeScript 配置
├── .gitignore                 # 已配置：node_modules/dist/target
│
├── src/                       # 前端（React + TS）
│   ├── main.tsx               # React 入口
│   ├── App.tsx                # 根组件 → 挂载 TianyiPet
│   ├── App.css                # 全局样式（透明背景）
│   ├── vite-env.d.ts
│   └── components/
│       └── TianyiPet.tsx      # 核心：天依 SVG 角色组件
│           ├─ 状态机 (PetState type)
│           ├─ 呼吸动画 (Date.now 驱动)
│           ├─ 眨眼定时器
│           ├─ 拖拽事件 (mousedown/move/up)
│           └─ SVG 角色定义
│
├── src-tauri/                 # 后端（Rust + Tauri）
│   ├── Cargo.toml             # Rust 依赖
│   ├── Cargo.lock
│   ├── build.rs
│   ├── tauri.conf.json        # ⚠️ 核心：窗口配置
│   ├── capabilities/default.json
│   ├── src/
│   │   ├── main.rs            # Rust 入口
│   │   └── lib.rs             # Tauri 命令注册
│   ├── icons/                 # 应用图标
│   └── .gitignore
│
├── public/                    # 静态资源
│   └── tauri.svg
│
└── .vscode/
    └── extensions.json        # VS Code 推荐插件
```

---

## 窗口配置（tauri.conf.json 关键部分）

```json
"windows": [{
  "label": "main",
  "width": 400,
  "height": 500,
  "decorations": false,      // 无边框
  "transparent": true,        // 透明背景
  "alwaysOnTop": true,        // 置顶
  "skipTaskbar": true,        // 不显示在任务栏
  "resizable": false,
  "shadow": false,
  "center": true
}]
```

---

## 角色状态机设计

```typescript
type PetState =
  | "idle"     // 默认待机，呼吸动画 + 随机眨眼
  | "blink"    // 眨眼（200ms 过渡态）
  | "listen"   // 听到音乐/声音，头部轻晃
  | "speak"    // 说话/开心，眯眼笑 + 张嘴
  | "sleep"    // 长时间无操作，闭眼 + zZZ
  | "drag"     // 被拖拽中（cursor: grabbing）
```

每个状态的视觉表现通过 React state 控制 SVG 对应元素（眼形、嘴形、头发旋转等），无帧动画，全是声明式渲染。

---

## 开发命令

```bash
# 启动开发模式（热重载 + Tauri 窗口）
npm run tauri dev

# 生产构建
npm run tauri build

# 仅启动前端 dev server（浏览器预览）
npm run dev

# 前端构建
npm run build

# Rust 检查
cd src-tauri && cargo check

# 查看 Git 日志
git log --oneline
```

---

## Rust 镜像源配置（已配好）

`C:\Users\32485\.cargo\config.toml`：

```toml
[source.crates-io]
replace-with = "ustc"

[source.ustc]
registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
```

---

## 关键参考项目

| 项目 | 链接 | 参考价值 |
|------|------|---------|
| Kokoro Engine | https://github.com/chyinan/Kokoro-Engine | Tauri v2 + Live2D/Pixi + LLM + TTS，最完整的开源桌宠实现 |
| Clawd on Desk | https://github.com/rullerzhou-afk/clawd-on-desk | Electron + SVG + Agent hooks，5.2k stars |
| Desktop Pet Framework | https://github.com/solt-frfr/desktop-pet-framework | Godot 桌宠，角色动画状态机参考 |
| OpenPet | https://github.com/X-T-E-R/OpenPet | Tauri + 透明窗口 + MCP 控制 |
| BongoCat | BongoCat (17k stars) | Tauri 透明窗口渲染管线已被大用户量验证 |

---

## 开发者备注

1. 如果 `cargo build` 下载依赖慢 → 检查 `.cargo/config.toml` 是否指向 USTC 镜像
2. 透明窗口调试时，Tauri 控制台会显示在 Vite dev server 终端（不是浏览器 F12）
3. SVG 角色当前是手写近似天依，后续可以用专业工具（Adobe Illustrator / Inkscape）导出优化
4. 首次 `npm run tauri dev` 的 `cargo build` 需要较长时间（下载几百个 crates），后续增量编译很快
5. 项目不需要 Git LFS（当前无大文件），将来加音频时再配置
6. `decorations: false` 会失去窗口标题栏，拖拽已由前端 JS 实现
7. npm 依赖使用宽松的 semver 范围，且根目录 `.gitignore` 当前忽略了 `package-lock.json`，不同机器执行 `npm install` 可能得到不同的小版本。排查依赖或构建问题时，先记录 `node --version` 和 `npm ls --depth=0`
