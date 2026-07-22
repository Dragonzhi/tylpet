# 任务：深度重构天依桌宠 Animation Studio

请重构 `tools/motion-editor/` 下的 SVG Animation Studio。

## 背景

天依桌宠是一个 Tauri v2 + React 19 + TypeScript 5.8 桌面桌宠应用。该编辑器是其独立的 Flash 风格 SVG 动画编辑器（基于 SVG-edit），用于制作角色动画动作。共享数学库在 `packages/character-motion/`，编辑器与生产桌宠通过它解耦。

## 技术约束

- React 19 / TypeScript 5.8 / Vite 7 / Vitest 3
- Tauri v2（窗口壳，不改 Rust 层）
- 已启用 `strict`、`noUnusedLocals`、`noUnusedParameters`，禁用 `any`
- 测试框架 Vitest

## 源码结构

```
tools/motion-editor/src/
├── App.tsx              # 1,298 行单体
├── editor/model/        # types.ts, documentCommands.ts, clipDiagnostics.ts
├── editor/session/      # reconcilePartRename.ts
├── editor/history/      # EditorHistory.ts
├── host/                # 宿主集成
├── import/              # 导入逻辑
├── project/             # 项目管理与导入导出
├── svgcanvas/           # SVG 画布（SVG-edit 适配）
├── timeline/            # 时间轴与关键帧
├── motion/              # 动作数据
├── components/          # UI 组件
├── styles.css           # 713 行单体 CSS
└── main.tsx             # 挂载点
```

## 目标

- 给出当前架构问题的审查报告
- 制定并执行重构计划
- 重构后功能不变（rig/motion 导入导出、画布编辑、时间轴、撤销等所有现有功能必须完整保留）

你来决定怎么拆、怎么组织、怎么改。先读代码再行动，分批给我看你的计划和结果。
