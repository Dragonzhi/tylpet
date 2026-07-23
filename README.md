# 小洛宝

一个运行在 Windows 桌面上的轻量透明桌面伙伴。当前 `0.1.0` 是开发预览版本：基础桌宠完全离线可用，模型对话、Agent、语音、系统音乐反应、长期记忆和创作者插件均为可选能力。

> 本项目是非官方同人技术原型，与洛天依及相关权利方不存在官方隶属或背书关系。当前角色素材和名称尚未完成公开发行授权审查；预览构建仅用于开发、自用和受控测试，不应作为正式商业发行包传播。

## 当前能力

- 分层 SVG 角色、呼吸/眨眼/鼠标跟随、拖动惯性、单击招手和两态口型。
- 小型透明置顶窗口、角色轮廓外点击穿透、多显示器拖动、原生右键菜单和托盘退出路径。
- 可恢复的番茄钟，以及仅观察 `playing / paused / stopped` 的可选系统音乐反应。
- 独立对话窗口、离线 Mock Provider、可配置 OpenAI-compatible Provider 和受控白名单 Agent 工具。
- Windows 本机 TTS、可管理的长期记忆与确定性羁绊。
- 声明式创作者插件桥接；插件不能直接访问 DOM、Tauri capability、模型密钥或可信动作执行器。

更完整的产品状态、边界和路线图见 [HANDBOOK.md](./HANDBOOK.md)，阶段实施情况见 [计划.md](./计划.md)。

## 安装与运行

预览版目标平台为 Windows 10 22H2 / Windows 11 x64，运行时需要 Microsoft Edge WebView2。当前主要在 Windows 11、常见 100%–150% DPI 和多显示器环境开发验证；ARM64、Windows 10 更早版本、远程桌面及低端硬件尚未形成兼容承诺。

1. 从对应预览 tag 的构建产物取得 `小洛宝_*_x64-setup.exe`。
2. 运行 NSIS 安装包。预览构建暂未代码签名，Windows SmartScreen 可能显示未知发布者。
3. 启动后，小洛宝通常显示在桌面右下区域；若未看到角色，单击托盘中的小洛宝图标。
4. 退出请使用角色右键菜单、托盘菜单，或按 `Ctrl+Shift+Q`。

不要通过任务管理器结束进程作为日常退出方式，否则最后一刻的设置可能来不及写入。

## 基础交互

| 操作 | 结果 |
|---|---|
| 单击角色 | 招手一次 |
| 按住并拖动角色 | 移动桌宠窗口 |
| 右键角色 | 置顶、居中、打开对话和退出 |
| 左键托盘图标 | 重新显示主角色窗口 |
| 托盘右键 | 打开对话、设置或退出 |
| `ContextMenu` / `Shift+F10` | 键盘打开角色菜单 |
| `Ctrl+Shift+Q` | 从任意位置退出小洛宝 |

设置页可以配置点击穿透、动画强度、番茄钟、模型、语音、系统音乐反应、插件、长期记忆和羁绊。联网、系统观察、语音、长期记忆以及 Agent 均可独立关闭。

## 模型与隐私

默认 Provider 是离线 Mock，不访问网络，也不产生模型费用。切换到外部 OpenAI-compatible Provider 后，只有用户主动发送并同意外发的对话内容才会提交到所配置的 endpoint。

- API key 使用 Windows DPAPI 绑定当前 Windows 用户加密，不写入普通设置文件，也不返回 WebView。
- 默认只允许 HTTPS；局域网/VPN 的 HTTP 模型地址必须由用户显式开启，内容和 Bearer key 会以明文经过该网络。
- 系统音乐反应只读取播放、暂停、停止状态，不读取标题、歌手、歌词、进度或音频内容。
- 完整聊天只存在于当前对话窗口内存；长期记忆只保存用户明确创建或确认的摘要。
- 开启“向模型提供已保存记忆”后，记忆摘要可能发送到用户配置的外部 Provider。
- 创作者插件只监听随机本机回环端口，使用独立随机凭据并受到 schema、权限、大小、频率和兼容版本约束。

## 数据、备份与恢复

运行数据默认位于：

```text
%APPDATA%\com.tauri-app.ltypet
```

其中可能包含 `settings.json`、`timer-state.json`、`memory.v1.json`、备份文件、插件注册表和加密密钥文件。需要手动备份时：

1. 先从托盘彻底退出小洛宝。
2. 复制整个数据目录到安全位置。
3. 恢复时在相同应用版本和相同 Windows 用户下覆盖回原目录，再启动应用。

API key 的 DPAPI 密文通常不能迁移到另一台电脑或另一个 Windows 用户；跨机器恢复后应重新填写 key。设置和长期记忆具有版本迁移/损坏恢复逻辑，但预览版尚未承诺任意版本之间都可无损降级。

## 从源码运行

需要 Node.js 22、npm、Rust/Cargo 和 Tauri 的 Windows 构建前置环境。仓库纳入三个 `package-lock.json`，请优先使用 `npm ci`。

```powershell
npm ci
npm test
npm run build
npm run tauri dev
```

生成预览安装包：

```powershell
npm run release:verify
npm run tauri build
```

NSIS 产物位于 `src-tauri/target/release/bundle/nsis/`。如果开发服务提示端口 `1420` 被占用，请先关闭已有的本项目 Vite/Tauri 实例。

## Animation Studio 与插件开发

- SVG Animation Studio 位于 `tools/motion-editor/`，是独立开发工具，不进入桌宠生产 bundle。
- 创作者插件协议、JSON Schema 和示例位于 `docs/plugin/`、`tools/plugin-sdk/` 与 `examples/plugins/`。
- 新增 Agent 工具前阅读 [Agent工具扩展指南](./docs/Agent工具扩展指南.md)，不能只增加提示词或前端 schema。

## 已知限制

- 预览安装包未签名，也没有自动更新器；升级和回滚需要手动安装对应版本。
- 第二套服装、窗口边缘吸附、在线插件市场和完整主动行为尚未完成。
- 低端设备性能、Windows 10 更早版本、ARM64 和跨机器数据迁移尚未完整验收。
- 角色素材、应用图标和名称在公开发行前仍需独立完成权利审查。

## 许可与素材

仓库目前没有授予覆盖全部源码与素材的统一开源许可证；除各第三方依赖自身许可证外，默认保留所有权利。角色设计、名称与衍生素材不因源码可见而自动获得复制、再发行或商业使用许可。

引用、修改或发布前，请分别核对：

- 洛天依及相关角色/IP 的二次创作和商用规则。
- `src/assets/`、`src-tauri/icons/` 中素材的作者、来源与授权范围。
- npm、Cargo 和 Animation Studio 第三方依赖的许可证及 notice 要求。

本仓库中的外部项目只作为架构参考；不要在未核对许可证的情况下复制其代码或素材。
