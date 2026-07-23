# 天依桌宠 Agent 开发指南

本文档只描述编码 Agent 在本仓库工作时必须遵守的工程事实、约束和验证流程。产品愿景、当前功能和路线图统一维护在 [`HANDBOOK.md`](./HANDBOOK.md)，具体实施顺序、阶段依赖和交接进度维护在 [`计划.md`](./计划.md)，不要在多份文档中重复维护同一份功能清单。

## 1. 文档职责与事实优先级

| 信息 | 权威来源 |
|---|---|
| 产品愿景、已实现体验、功能边界、路线图 | `HANDBOOK.md` |
| 实施顺序、阶段依赖、里程碑进度 | `计划.md` |
| 前端依赖与 npm scripts | `package.json` 和当前安装结果 |
| Rust 依赖 | `src-tauri/Cargo.toml`、`Cargo.lock` |
| 窗口行为 | `src-tauri/tauri.conf.json` 和真实 Tauri 验证 |
| Tauri 权限 | `src-tauri/capabilities/default.json` |
| 当前实现 | 源码、测试和实际运行结果 |
| Agent 工作规则与完成标准 | 本文档 |

发生冲突时，按“代码与配置 → 实际校验结果 → 文档”的顺序判断。修改产品状态或路线图时更新 `HANDBOOK.md`；修改工程约束、入口或验证流程时才更新本文档。

## 2. 当前技术基线

| 层 | 当前实际配置 |
|---|---|
| 桌面壳 | Tauri v2，主要平台为 Windows |
| 前端 | React 19 + TypeScript 5.8 |
| 构建与测试 | Vite 7 + Vitest 3 |
| 角色渲染 | React 内联分层 SVG |
| Rust | edition 2021；交接环境为 Rust/Cargo 1.97.0 |
| Node | 交接环境为 Node 22.20.0 |

`package.json` 仍使用 semver 范围，但根应用、共享动画包和 Animation Studio 的 `package-lock.json` 均纳入版本控制；干净构建和发布使用 `npm ci`，不要用一次新的 `npm install` 结果静默改写锁文件。涉及依赖或构建问题时，仍先记录 `node --version` 和 `npm ls --depth=0`。

## 3. 关键入口与职责边界

| 路径 | 职责 |
|---|---|
| `src/components/TianyiPet.tsx` | 角色状态、动作入口、拖动与右键交互编排 |
| `src/components/TianyiArtwork.tsx` | 内联 SVG、图层 rig、pivot 测量与包装 |
| `src/assets/character/xiaoluobao/artwork.source.svg` | Inkscape 可编辑角色源文件；保留图层 label 和编辑信息 |
| `tools/artwork/build-artwork.mjs` | 校验、规范化角色 SVG，并同步生产素材指纹 |
| `src/config/petAnimation.ts` | 跟随、呼吸、头发惯性等动画参数 |
| `src/config/petInteraction.ts` | 点击穿透、命中容差与窗口拖动参数 |
| `src/hooks/usePetMotion.ts` | 鼠标跟随、耳朵和头发动态 |
| `src/hooks/useWindowDrag.ts` | 非阻塞原生窗口拖动 |
| `src/hooks/useClickThrough.ts` | SVG 轮廓命中与动态点击穿透 |
| `src/controllers/TauriTimerController.ts` | 前端统一番茄钟接口与原生事件适配 |
| `src/components/ChatWindow.tsx` | 独立对话窗口、流式展示、键盘发送与取消交互 |
| `src/domain/chat/`、`src/providers/` | Provider 契约、上下文预算、离线 Mock 与原生模型适配 |
| `src/domain/observations/` | M13 观察事件协议、校验、授权策略、反应映射和 Host |
| `src/domain/plugins/`、`src/components/PluginSettingsPanel.tsx` | 创作者插件前端契约、动态 grant 和侧载管理 UI |
| `src/components/ObservationRuntimeBridge.tsx` | 将设置、安全停止和逐来源 grant 应用到主窗口 ObservationHost |
| `src/motion/` | 可独立测试的动画与交互数学 |
| `src/App.css` | SVG/CSS 动画与图层样式 |
| `src-tauri/src/lib.rs` | Tauri Builder、全局鼠标钩子、原生命令与菜单 |
| `src-tauri/src/timer.rs` | 可靠计时状态机、持久化、恢复与完成提醒 |
| `src-tauri/src/chat.rs` | OpenAI-compatible HTTPS/SSE、有限重试、错误映射与取消 |
| `src-tauri/src/media.rs` | Windows 系统媒体播放状态观察；只读取 playing/paused/stopped |
| `src-tauri/src/plugins.rs` | 声明式插件注册表、回环桥接、随机凭据与 `ltypet emit` CLI |
| `src-tauri/src/secrets.rs` | Windows DPAPI 密钥存储和旧明文文件迁移 |
| `src-tauri/tauri.conf.json` | 窗口和 bundle 配置 |
| `src-tauri/capabilities/default.json` | 主窗口最小权限集合 |

- `src/` 负责视觉、前端状态和用户交互；连续计算应提取到 hook 或 `src/motion/`，不要继续堆入组件。
- `src-tauri/src/` 负责系统集成、可靠计时、持久化和需要原生权限的能力。
- 新增 Tauri API 或插件时，同时检查 Rust 注册、前端依赖和 capability；只改一处通常无法工作。
- `tauri.conf.json` 是窗口行为的配置来源，但透明、置顶、DPI、点击穿透和多屏行为必须以真实窗口验证为准。

## 4. 关键实现约束

### 窗口与交互

- 保持“小透明窗口 + 移动原生窗口”的模型，不为跨桌面移动而扩展成全屏 WebView。
- 自定义拖动必须使用物理屏幕坐标，并正确处理 DPI、负坐标和多显示器；不要退回会阻塞动画的系统拖动循环作为主要路径。
- 角色轮廓外可以点击穿透，但拖动或原生菜单打开期间必须强制保持可交互。
- 必须保留可靠退出路径。当前入口是角色右键菜单和 `Ctrl+Shift+Q`。
- 吸附、位置恢复和居中需要验证多显示器、不同缩放、负坐标、任务栏和工作区。

### 动画与状态

- 持续状态和短暂动作分开建模；短暂动作结束后恢复此前合法状态，不用多个布尔值表达同一状态。
- 连续视觉动画优先使用 CSS/SVG animation；必须由 JS 驱动时使用可清理的 `requestAnimationFrame`。
- 所有 timeout、interval、animation frame、Web Animation 和全局监听都必须在 cleanup 中释放，并考虑 React StrictMode 与 HMR 重挂载。
- SVG 旋转围绕素材中的 pivot。测量 pivot 时排除正在生效的祖先变换，避免 StrictMode 或 HMR 后轴心漂移。
- 不直接手改生产 `artwork.svg`。使用 Inkscape SVG 格式编辑 `artwork.source.svg`，再运行 `npm run artwork:build`；普通构建只执行 `artwork:check`，产物过期时应失败而不是静默重写。
- 全局鼠标与窗口位置是物理像素，DOM 包围盒是 CSS 像素；换算时必须使用当前 `scaleFactor`。
- 所有新增动画都要尊重 `prefers-reduced-motion`，并把可调幅度、周期和阈值集中到配置文件。

### Rust、权限与隐私

- 原生能力通过小而清晰的 Tauri command、事件或官方插件暴露，不把系统细节散落到 React 组件。
- capability 遵循最小授权原则；不要为了消除报错扩大成宽泛权限。
- API key、token 和聊天内容不得提交到仓库。系统窗口、音频活动等感知数据默认只在本地处理，外发必须显式告知并可关闭。
- 番茄钟等长期计时使用时间戳或原生层保证准确性，不依赖前端 interval 累加秒数。
- Rust 原生路径不得因普通 API 失败而 `panic`；向前端返回错误或记录可诊断日志。

### 创作者插件与外部事件

- 此处“创作者插件”是 ltypet 产品扩展协议，不等同于 Tauri 官方插件；两者的权限、安装和信任边界不得混用。
- Codex、Claude Code、IDE、媒体播放器等外部联动属于产品插件，不是核心组件中的特判逻辑。核心只消费版本化、可校验的观察事件。
- 第三方插件默认不可信。不得在主进程或 WebView 中直接加载第三方任意 JS/Rust，也不得向插件暴露 API key、Tauri command、DOM、原始窗口控制或主程序 capability。
- 插件事件必须经过来源授权、schema、大小、频率、去重和隐私策略，再由核心映射为语义动作并提交 `BehaviorScheduler`；插件不能直接提交可信动作或伪造成功结果。
- 插件 manifest、宿主兼容版本、权限和事件类型必须显式声明。安装、启用、禁用、卸载、崩溃和版本不兼容都要有可恢复路径。
- 开发 Agent 插件默认只传生命周期状态，不传代码、prompt、工具参数、终端输出或文件内容；增加任何敏感字段都需要独立权限、脱敏和用户可见说明。

### React 与 TypeScript

- 保持 `strict`、`noUnusedLocals`、`noUnusedParameters` 和 `noFallthroughCasesInSwitch` 通过，不用 `any` 或关闭检查掩盖问题。
- UI 文案默认使用简体中文，代码标识符使用清晰英文。
- 可访问交互不能只绑定鼠标；菜单、按钮和对话框要有键盘路径及合适语义。
- 不在 render 中读取时间并期待 React 自动刷新，也不要用重挂载 SVG 节点的方式重启动画。

## 5. 工作流程与验证

1. 开始前运行 `git status --short`，保留用户已有修改，不回退无关文件。
2. 阅读任务涉及的源码和配置；选择后续实施任务或判断前置依赖时查看 `计划.md`，需要产品背景或优先级时再查看 `HANDBOOK.md`。
3. 做最小而完整的纵向改动。涉及原生能力时一并处理 Rust、前端调用、错误路径、capability 和相关文档。
4. 新增非平凡状态、计时、坐标换算或 Rust 业务逻辑时增加相应单元测试。
5. 汇报实际运行的检查和无法完成的真实窗口验证，不把未观察的行为写成已验证。
6. 不自动提交或推送，除非用户明确要求。

常用命令：

```powershell
npm test
npm run artwork:build
npm run artwork:check
npm run build
npm run tauri dev
npm run tauri build

cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

git diff --check
```

最低验证要求：

- 前端或文档以外的代码变更：`npm test`、`npm run build`、`git diff --check`。
- Rust、Tauri 配置、插件或 capability 变更：追加 `cargo test`、`cargo check`、`cargo fmt --check`。
- 窗口、拖动、DPI、穿透或原生菜单变更：追加真实 `npm run tauri dev` 验证；浏览器预览不能替代。
- 仅 Markdown 修改：检查链接、事实边界和 `git diff --check`，无需为了文档改动重跑完整构建。

## 6. 完成标准

- 请求行为完成，自动化检查通过，平台相关行为按风险完成真实窗口验证。
- 没有泄漏定时器、监听器、动画帧或测试进程。
- 没有扩大无关权限、提交秘密、引入隐私外发或覆盖用户已有修改。
- 差异只包含任务相关内容，不含无关格式化和生成物。
- 产品状态变化只在 `HANDBOOK.md` 维护一次；工程规则变化只在本文档维护一次。

## 7. 本机环境备注

- Vite/Tauri 开发端口固定为 `1420`；启动失败时先检查是否已有本项目 dev 实例。
- Cargo 在交接机器上位于 `C:\Users\32485\.cargo\bin`。若不在 `PATH`，可使用 `& "$HOME\.cargo\bin\cargo.exe" ...`。
- 用户级 Cargo 使用 USTC 镜像，这是本机设置，不属于仓库配置，也不能假定其他开发者已配置。
- 外部架构参考和角色 IP/素材使用边界见 `HANDBOOK.md`。
