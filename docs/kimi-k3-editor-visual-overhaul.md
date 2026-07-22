# 任务：天依桌宠 Animation Studio 视觉美化

请美化 `tools/motion-editor/` 下的 SVG Animation Studio。**这是纯视觉优化，架构已经重构完毕，不要动组件结构、hook 逻辑和功能代码。**

## 背景

天依桌宠是一个 Tauri v2 + React 19 + TypeScript 5.8 桌面应用。该编辑器是 Flash 风格 SVG 动画编辑器，用于制作角色动画动作。它是一个面向动画师的桌面工具。

## 当前视觉状态

- 暗色主题，深藏青底色（#111827）
- 蓝灰强调色，全部 flat 扁平设计
- 基本边框分割，极简圆角（3-4px）
- 无渐变、阴影、动效等视觉层次
- 13px 字号的 Segoe UI / system-ui
- 功能完整但视觉上像原型

## 风格要求

1. **简约现代编辑器风格**，参考 VS Code、Figma、Spline 等工具的暗色主题，不需要角色主题色
2. **干净的暗色主题**：柔和的深灰底、克制的强调色、清晰的层次区分
3. **增加视觉层次**：微妙渐变、精细边框、悬停动效、阴影层次，让面板有"浮起"感
4. **精致控件**：按钮、输入框、滑块、滚动条全部美化，间距和字号对齐设计系统
5. **保留暗色主题**：当前 color-scheme: dark 不变

## 设计约束

- 不改组件的 JSX 结构和逻辑（不改 .tsx 的业务逻辑部分）
- 不改 hook 和工具函数
- 只改 CSS 文件（`src/styles/*.css` 和 `src/styles.css`）
- 不改 `index.html` 和 `vite.config.ts`
- `p4-editor` 这个 CSS 类名保留，因为 App.tsx 引用它
- 所有现有功能必须保持正常

## CSS 文件结构（已拆分好）

```
src/styles.css          # 入口：@import 所有 CSS
src/styles/
├── base.css            # 全局变量、reset、按钮/输入框基础样式
├── layout.css          # 布局网格、recovery-banner
├── toolbar.css         # 顶部工具栏
├── sidebar.css         # 左右侧栏、part-tree
├── stage.css           # 舞台画布区
├── gizmo.css           # 变换 gizmo、pivot 手柄
├── inspector.css       # 属性检查器
├── timeline.css        # 时间轴、播放头、关键帧
├── clip-panel.css      # 片段面板
├── publish.css         # 发布对话框
└── responsive.css      # 响应式布局
```

先在 `base.css` 的 `:root` 中定义设计变量（颜色、间距、圆角、阴影），然后各组件文件引用变量。

源码都在当前目录下，你自己读文件分析。读完直接输出设计系统和美化后的完整 CSS 文件内容即可。
