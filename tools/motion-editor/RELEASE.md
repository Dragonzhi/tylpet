# Animation Studio 0.1.0 发布与使用说明

## 支持范围

- Windows 10/11 x64，依赖 Microsoft Edge WebView2 Runtime。
- project、rig、motions 均只支持 schema v1；编辑器和当前桌宠运行时的范围一致。
- 当前只验收小洛宝这一套角色；第二套服装、重定向和跨服装兼容不属于本版本。
- 项目以目录为单位，因此 v1 不注册单文件关联。程序启用 Windows 单实例；重复启动会直接退出第二实例。

## 从干净目录构建

要求 Node 22、npm、Rust 1.97+ 和 Tauri 的 Windows 构建前置环境。不要复用旧 `dist`。

```powershell
npm ci
npm --prefix packages/character-motion ci
npm --prefix tools/motion-editor ci
npm --prefix packages/character-motion run build
npm run build
npm --prefix tools/motion-editor run build
npm --prefix tools/motion-editor run notices:generate
npm --prefix tools/motion-editor run perf:baseline
npm --prefix tools/motion-editor run release:check
```

便携可执行文件：

```powershell
npm --prefix tools/motion-editor run build:portable
```

当前内部二进制仍输出到 `tools/motion-editor/src-tauri/target/release/ltypet-motion-editor.exe`，用户可见产品名为 `Tylpet Animation Studio`。它不携带项目，不写安装目录；WebView2 仍是系统前置条件。

NSIS 安装包：

```powershell
npm --prefix tools/motion-editor run build:installer
```

## 项目、备份与恢复

- 项目目录保存 `project.ltypet.json`、`artwork.svg`、rig、motions 和 `editor.json`；用户应把整个目录作为一个单元备份。
- 每次覆盖保存前，旧版本写入项目内 `.ltypet-backups/`，最多保留 5 份。恢复时先打开原项目，在右侧“诊断”面板展开“项目备份（n/5）”，再点击对应时间的“恢复”；恢复前当前版本也会先备份。不要通过“打开项目”直接选择 `.ltypet-backups` 内部目录，内部快照只用于编辑器管理和紧急人工取回。
- 自动 recovery 位于 `%APPDATA%\com.ltypet.animation-studio\recovery-v1`，只用于异常退出后的未保存修改，不替代项目备份。
- 最近项目和 recovery 属于用户配置数据。卸载程序不得删除外部项目；升级/降级前应复制项目目录和上述 AppData 目录。
- 项目损坏、未知 schema、只读目录或写入失败会返回结构化错误；不要手工删除 `.ltypet-txn-*`。重新打开项目会先按事务日志回滚半写文件。
- 最近项目路径失效时可从列表移除，再通过“打开项目目录”重新授权新位置。中文路径受支持；超长路径仍受 Windows 系统长路径策略限制。

## 动作制作与发布

1. 打开包含匹配 artwork、rig、motions 的项目目录。
2. 在 Part 树选择部件，以 F6 建立关键帧，通过 Gizmo/Inspector 调整，并在时间轴逐帧预览。
3. 保存项目并关闭重开，确认采样结果一致；“导出文件…”会通过原生目录选择器一次写出 canonical rig/motions，并在日志中显示目录，但不等同于保存项目。
4. 开发仓库内可使用“发布到正式资源”。发布前会验证 schema、素材指纹、允许事件和差异；正式发布构建会禁用该入口。
5. 发布后必须在真实桌宠 Tauri 窗口验证动作、中断、拖动、点击穿透和程序动画恢复。

## 升级、降级与回滚

- 升级前复制项目和 AppData；新版本首次打开旧 schema 时必须先迁移副本。0.1.0 没有 v1 以前的公开项目 schema，因此当前没有隐式迁移器。
- 未知或更高 schema 会被明确拒绝，不会原地改写。不要通过手改 `schemaVersion` 绕过校验。
- 降级时先查兼容矩阵；0.1.0 只读写 v1。若新版本已保存更高 schema，使用升级前项目副本或 `.ltypet-backups`，不要让旧版覆盖新格式。
- 生产动作回滚使用版本控制恢复 `src/assets/character/xiaoluobao/rig.v1.json` 与 `motions.v1.json`，然后重跑测试和真实窗口验收。

## 诊断、性能与隐私

- “导出诊断”只包含程序版本、OS/架构、支持的 schema 及 recovery/最近项目数量，不包含项目路径、SVG、动作内容、用户文本或密钥。
- 项目、recovery、备份和日志均在本地处理；本版本没有 LLM、网络上传、遥测、任意 shell 或通用文件系统能力。
- 正式素材发布阈值：artwork 2 MB、rig 1 MB、motions 5 MB、1000 Clips、100000 关键帧；超限必须重新评估交互和内存，不应只调高阈值。
- `release:check` 确认生产桌宠 bundle 不含 SVGCanvas/编辑器 UI，编辑器 bundle 不含桌宠全局钩子、拖动命令或密钥标识。

## 已知问题与人工发布门

- SVGCanvas 主 chunk 较大，但只存在于独立编辑器。
- 安装、升级、降级、卸载数据保留以及 100%/150%/200% DPI、多屏、休眠恢复、显卡/WebView2 差异必须在目标 Windows 机器人工验收；自动化不能替代。
- v1 以目录作为项目，未实现文件关联；外接盘暂时离线时，最近项目需要重新选择。
- 公开分发前必须完成角色素材、图标和所有 `UNKNOWN` 许可证项的权利核实。
