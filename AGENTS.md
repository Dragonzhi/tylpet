# 天依桌宠 Agent 开发指南

本文档供后续在本仓库工作的编码 Agent 使用。开始任务前先阅读本文，再按需阅读 `HANDBOOK.md` 和相关源码。`HANDBOOK.md` 记录产品愿景与交接背景；代码、配置文件和锁文件描述当前真实实现。两者冲突时，以代码和实际校验结果为准，并在修改时同步相关文档。

## 1. 项目目标

本项目是一款 Windows 桌面宠物应用：洛天依常驻桌面，后续将逐步具备角色动画、点击和拖拽交互、番茄钟、系统状态感知、LLM 对话、Lo-Fi 音乐以及羁绊系统。

产品体验应保持以下特征：

- 轻量、安静，不打断用户当前工作。
- 角色表现自然、有陪伴感，而不是普通工具悬浮窗。
- 默认保护隐私；系统感知、音频检测和 LLM 数据发送必须显式、可控。
- 即使网络、LLM 或音频能力不可用，基础桌宠仍可独立运行。

当前版本为 `0.1.0`，仍是最小原型，不要把愿景列表误判为已落地功能。

## 2. 当前技术基线

| 层 | 当前实际配置 |
|---|---|
| 桌面壳 | Tauri v2 |
| 前端 | React 19 + TypeScript 5.8 |
| 构建 | Vite 7 |
| 角色渲染 | React 内联 SVG |
| Rust | Rust/Cargo 1.97.0，edition 2021 |
| Node | 交接环境为 Node 22.20.0 |
| 主要平台 | Windows |

注意：`HANDBOOK.md` 中的 React 18、Vite 6 是旧描述；`package.json` 和当前安装结果分别为 React 19、Vite 7。依赖使用宽松的 semver 范围，而根目录 `.gitignore` 又忽略了 `package-lock.json`，因此不同机器执行 `npm install` 可能得到不同的小版本。涉及依赖或构建问题时，先记录 `node --version` 和 `npm ls --depth=0`。

## 3. 仓库地图与职责边界

```text
.
├─ index.html                    Web 入口，语言为 zh-CN
├─ package.json                  前端依赖与 npm scripts
├─ vite.config.ts                Tauri 配套 Vite 配置，固定端口 1420
├─ tsconfig.json                 严格 TypeScript 配置
├─ HANDBOOK.md                   产品愿景、交接说明和路线图
├─ src/
│  ├─ main.tsx                   React 入口，启用 StrictMode
│  ├─ App.tsx                    根组件，仅挂载 TianyiPet
│  ├─ App.css                    透明全屏根节点及全局 reset
│  └─ components/TianyiPet.tsx   当前角色、状态骨架、拖动与右键菜单交互
└─ src-tauri/
   ├─ tauri.conf.json            窗口、构建和 bundle 配置
   ├─ capabilities/default.json  主窗口可调用的 Tauri 权限
   ├─ Cargo.toml                 Rust/Tauri 依赖
   └─ src/
      ├─ main.rs                 桌面进程入口
      └─ lib.rs                  Tauri Builder、全局鼠标钩子与原生菜单
```

职责约定：

- `src/` 负责视觉、前端状态和用户交互。
- `src-tauri/src/` 负责计时可靠性、系统集成、持久化和其他需要原生权限的能力。
- 新增 Tauri API 或插件时，同时检查 Rust 注册、前端依赖和 `capabilities/default.json`；只改其中一处通常无法工作。
- `tauri.conf.json` 是窗口行为的核心来源。修改透明、置顶、任务栏、尺寸或安全设置时，应同时在真实 Tauri 窗口中验证，不能只看浏览器预览。

## 4. 当前真实行为

### 已经可用

- Tauri 主窗口为 `400 × 500`，无边框、透明、置顶、跳过任务栏、禁止缩放、关闭阴影并在启动时居中。
- 前端渲染一个 `200 × 340` 的内联 SVG 临时角色。
- `PetState` 声明了 `idle | blink | listen | speak | sleep | drag` 六种状态。
- `idle` 状态会每隔约 3–5 秒切换到 `blink` 约 200 ms。
- 鼠标可拖动角色元素在 WebView 内容区域内改变其绝对定位。
- 角色轮廓上可弹出 Windows 原生右键菜单，支持切换置顶、回到当前屏幕中央和退出；`ContextMenu`、`Shift+F10` 与 `Ctrl+Shift+Q` 均有键盘路径。
- Rust 端注册了模板遗留的 `greet` 命令和 opener 插件；前端目前均未使用。
- 前端生产构建和 Rust `cargo check` 在 2026-07-12 的交接环境中通过。

### 尚未真正实现或存在偏差

- 透明窗口不等于点击穿透。当前配置和代码没有启用系统级忽略鼠标事件，角色也会主动接收 `mousedown`。
- 当前拖拽只移动窗口内部的 SVG，不移动 Tauri 窗口，无法实现桌面范围拖放、吸附或位置持久化。
- `listen`、`speak`、`sleep`、`drag` 只有渲染分支或类型声明，没有可达的完整状态转换；拖拽时使用的是独立的 `isDragging`，并未进入 `drag` 状态。
- 呼吸和手臂摆动直接读取 `Date.now()`，但没有 `requestAnimationFrame`、定时刷新或 CSS animation 驱动，因此不会稳定连续播放，只会在其他 state 更新造成重渲染时跳变。
- 从 `listen` 触发眨眼后，现有定时器会回到 `idle`，不能恢复此前状态。
- 眨眼内部的 `setTimeout` 没有单独清理。组件目前很小，但重构状态机时应一起修正生命周期。
- 没有测试框架、lint script、格式化配置、设置页、持久化、系统感知、番茄钟、聊天或音频实现。
- `README.md` 仍是 Tauri 模板内容，并非项目使用说明。

不要仅为了让文档中的勾选项成立而添加表面实现。处理相关功能时，应先修正真实交互模型，再更新状态说明。

## 5. 关键实现约束

### 窗口与交互

- 桌宠需要跨桌面移动时，应移动 Tauri 原生窗口，而不是无限增大或平移窗口内 SVG。
- 无边框窗口的拖动优先使用 Tauri 提供的窗口拖动 API，并配置最小必要 capability；注意浏览器预览没有等价原生行为。
- 若实现“空白区域点击穿透、角色区域可交互”，要设计明确的模式切换或命中区域策略，避免用户无法再次操作或退出应用。
- 必须保留可退出入口。当前可通过角色右键菜单或 `Ctrl+Shift+Q` 退出；后续修改点击穿透、菜单或托盘时，要防止形成无法关闭的窗口。
- 多显示器、DPI 缩放、负坐标、任务栏位置和可视工作区都是窗口吸附/位置恢复的验收条件。

### 动画与状态

- 角色状态应有单一事实来源。避免同时用 `PetState` 和多个布尔值表达同一状态而产生冲突。
- 区分持续状态（如 `idle`、`sleep`）和短暂动作（如 `blink`）；短暂动作结束后应恢复之前的合法状态。
- 连续视觉动画优先使用 CSS/SVG animation；必须由 JS 驱动时，使用可清理的 `requestAnimationFrame`，不要在 render 中读取时间后期待 React 自动刷新。
- 所有 interval、timeout、animation frame 和全局事件监听都必须在 effect cleanup 中释放，并考虑 React StrictMode 开发环境下 effect 会额外执行的情况。
- 尊重系统“减少动态效果”偏好；未来增加粒子和律动时提供降级路径。

### Rust、权限与数据

- 原生能力通过小而清晰的 Tauri command 或官方插件暴露，不要把系统细节散落到 React 组件。
- 新权限遵循最小授权原则，并说明为何需要；不要把 capability 扩为宽泛的全权限来绕过报错。
- API key、token 和用户聊天内容不得提交到仓库。未来接入 LLM 时，密钥应进入安全配置或系统凭据存储。
- 系统前台窗口、音频活动等感知数据默认只在本地处理；任何外发都必须让用户知情。
- 番茄钟等需要准确性的长期计时以时间戳/原生层为准，不依赖前端 interval 累加秒数。

### React 与 TypeScript

- 保持 `strict`、`noUnusedLocals`、`noUnusedParameters` 和 `noFallthroughCasesInSwitch` 通过，不用 `any` 或关闭检查掩盖问题。
- 组件负责渲染，状态调度、计时、窗口控制逐步提取为 hook 或独立模块；不要继续把所有能力堆入 `TianyiPet.tsx`。
- 可访问交互不要只绑定鼠标事件；新增菜单、按钮或对话框时提供键盘路径和适当语义。
- UI 文案默认使用简体中文，代码标识符使用清晰英文，现有中文注释可保留。

## 6. 常用命令

在仓库根目录运行：

```powershell
npm install
npm run dev
npm run build
npm run tauri dev
npm run tauri build
```

Rust 校验：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

当前交接机器的 Cargo 已安装在 `C:\Users\32485\.cargo\bin`，但该目录可能不在 PowerShell `PATH`。若直接执行 `cargo` 报“无法识别”，可在本机临时使用：

```powershell
& "$HOME\.cargo\bin\cargo.exe" check --manifest-path src-tauri/Cargo.toml
```

Cargo 使用用户级 USTC 镜像配置；这是本机环境，不属于仓库配置，不应假定其他开发者也已配置。

## 7. Agent 工作流程

1. 开始前运行 `git status --short`，保留用户已有修改。当前 `HANDBOOK.md` 可能处于用户编辑状态，不要覆盖或回退。
2. 阅读任务涉及的源文件和配置，核对 `HANDBOOK.md` 但不盲信其中的版本号或完成状态。
3. 做最小、完整的纵向改动。例如新增原生窗口 API 时，一并完成 Rust/插件、capability、前端调用、错误处理和文档。
4. 至少运行 `npm run build`；修改 Rust、Tauri 配置、插件或 capability 时，再运行 `cargo check`。窗口行为改变时还需运行 `npm run tauri dev` 做手工验证。
5. 汇报实际运行过的检查以及无法运行的检查，不要声称未验证的功能已完成。
6. 不修改无关文件，不回退用户改动，不使用破坏性 Git 命令，不自动提交或推送，除非用户明确要求。

仓库目前没有自动化测试。新增非平凡状态逻辑、计时器、持久化或 Rust 业务逻辑时，应同时引入适合该层的测试；不要只依赖视觉观察。

## 8. 完成标准

一次改动只有同时满足以下条件才算完成：

- 行为符合请求，并在 Tauri 与浏览器差异相关时验证真实桌面窗口。
- `npm run build` 通过；涉及 Rust 时 `cargo check` 通过。
- 没有遗留未清理的定时器、监听器或动画帧。
- 没有扩大不必要的 Tauri 权限，没有引入明文秘密或隐私外发。
- 用户已有修改保持完好，差异中不含无关格式化或生成物。
- 影响架构、命令、当前状态或产品路线图时，同步更新本文、`HANDBOOK.md` 或 `README.md` 中真正相关的部分。

## 9. 近期建议顺序

除非用户指定其他优先级，建议按以下依赖关系推进：

1. 修复连续动画驱动和状态机生命周期，建立可靠的角色行为基础。
2. 把“拖动 SVG”改为“拖动原生窗口”，再实现多屏边界、吸附和位置持久化。
3. 增加托盘与设置入口（基础右键菜单和退出已落地）。
4. 完善角色素材、表情、视线和粒子效果。
5. 将番茄钟、系统感知等本地原生能力模块化接入。
6. 最后接入 LLM、TTS/音频和羁绊系统，并提供离线降级与隐私控制。

外部参考项目见 `HANDBOOK.md`。参考其架构思想即可，复制代码或美术/音频资产前必须核对许可证与角色 IP 使用边界。
