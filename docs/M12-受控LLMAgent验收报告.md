# M12 受控 LLM Agent 验收报告

> 状态：已完成；自动化与真实 Tauri 核心闭环均通过。
>
> 范围：白名单语义工具、Agent turn、预算与频率策略、逐次确认、跨窗口调度和结构化结果；不包含系统感知、长期记忆、TTS 或任意系统操作。

## 1. 已实现边界

模型可请求以下 `ltypet-agent-tools/v1` 工具：

- `pet_play_motion`
- `pet_set_expression`
- `pet_set_look`
- `pet_move_window`
- `timer_start`
- `timer_pause`
- `timer_resume`
- `timer_cancel`

工具名和参数不会直接执行。它们先映射为 M1 `ActionRequest`，再由主窗口重新执行能力、白名单、Agent 开关、确认、频率和冷却校验，最后提交 `BehaviorScheduler`。模型只会收到调度器产生的真实 `ActionResult`。

M12.1 收尾后，工具目录不再是静态常量。聊天窗口会在每轮开始前使用主窗口能力快照生成 schema：`motion` 和 `expression` 是运行时精确 enum，描述同时提供英文 ID 与中文含义；当前无能力的工具不会暴露。即使模型绕过 enum 创造参数，本地也会拒绝并把允许值作为结构化工具结果返回，便于模型自行纠正。

工具执行记录现已合并进聊天时间线，作为“小洛宝 · 工具”气泡按顺序展示，不再固定占用输入框上方区域。模型完成工具调用却没有返回最终文字时，本地会生成可进入短期会话的确定性收尾；“正在思考”只绑定当前 assistant 占位，历史空回复不会在后续请求中复活。

首版明确没有 shell、文件、进程、任意网络、DOM/CSS、原始窗口坐标和通用 Tauri command。`pet_move_window` 与 `timer_cancel` 每次都需要用户在聊天窗口确认。

## 2. 自动化结果

环境记录：

- Node：`v22.20.0`
- 当前安装：React `19.2.7`、Vite `7.3.6`、Vitest `3.2.7`、Tauri CLI `2.11.4`

检查项：

- `npm test`：36 个测试文件、424 项测试通过。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：14 项测试通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- Rust tool-call 测试覆盖 SSE 分片拼接和原生边界拒绝非白名单工具。
- Agent 测试覆盖确定性工具闭环、未知工具、提示注入文本、确认拒绝、工具循环上限和用户中断。
- M12.1 测试追加覆盖运行时 enum、能力缺失时隐藏工具、模型创造动作/表情 ID 后的允许值反馈，以及离线 Mock 不调用未暴露工具。

## 3. 离线 Mock 必验

先运行：

```powershell
npm run tauri dev
```

在设置中选择“离线 Mock”，开启“启用 Agent”，然后打开对话窗口。

1. 输入“请向我招手”。
   - 小洛宝应真实播放一次 `wave`。
   - 聊天窗口显示 `pet_play_motion — 已完成`。
   - Fake Model 在动作结果返回后回复“动作已经处理完成”。
2. 输入“请移动到右边”。
   - 动作执行前必须出现“需要你的确认”。
   - 第一次点“拒绝”：窗口不移动，工具记录显示未执行。
   - 等回复结束后再次输入并点“允许这一次”：小窗口平滑移动到当前屏幕右侧。
3. 输入“开始 1 分钟专注计时”。
   - 工具记录显示 `timer_start — 已完成`。
   - 打开设置后能看到正在进行的本地计时；关闭设置窗口不应丢失计时。
4. 关闭“启用 Agent”，再次输入“请向我招手”。
   - 只收到“离线 Mock”文本回复，角色不得因模型请求播放动作。
5. 开启 Agent，在动作运行或确认框出现时点击“立即停止所有自主行为”。
   - 当前 Agent turn 和动作停止，确认框消失；基础拖动、右键菜单和退出仍可用。

### 2026-07-22 实测记录

- 真实 Tauri 窗口使用离线 Mock 完成 `请向我招手`：角色动作经主窗口调度器执行，聊天显示 `pet_play_motion — 已完成`，Fake Model 在收到结果后正常收尾。
- `请移动到右边` 正确弹出逐次确认；拒绝时显示真实拒绝结果且窗口不移动；允许时显示 `pet_move_window — 已完成`，窗口截图原点从 `(1923, 361)` 变化为 `(1952, 389)`。
- 设置在 OpenAI-compatible 与 Mock、Agent 开关之间实时同步；验收结束后已恢复用户原有 `qwen3.5:2B`、远程 HTTP Provider、已保存密钥状态和 Agent 关闭状态。
- 首轮实测因等待确认超过 90 秒暴露“人工思考时间被计入 turn 超时”。现已改为确认期间暂停主动执行计时，同时增加 5 分钟独立确认上限和单元回归测试；修复后拒绝会正常返回模型并结束 turn。
- `Ctrl+Shift+Q` 正常结束验收实例，开发进程退出码为 0。

## 4. 优先级与回归

- Agent 招手或移动时直接拖动角色：用户拖动必须立即接管，Agent 动作终态不得伪装为成功。
- 打开角色右键菜单期间触发 Agent：新动作应等待；菜单关闭后才可能继续。
- 透明区域仍点击穿透，角色轮廓仍可单击、拖动和右键。
- `Ctrl+Shift+Q`、托盘退出、托盘恢复主窗口保持正常。
- 未联网、Provider 报错或 Agent 关闭时，呼吸、眨眼、鼠标跟随、拖动和菜单不受影响。

## 5. 真实模型可选验收

模型端必须支持 OpenAI-compatible Chat Completions 的 function/tool calling。Ollama 使用：

```text
http://26.70.113.57:11434/v1/chat/completions
```

不要填写 `/api/generate`。设置正确模型名、允许外发；临时 Radmin VPN HTTP 测试还需开启“允许 HTTP 明文接口”。发送“请先招手，再简短告诉我完成了什么”，预期聊天标题显示实际工具数量，模型调用 `pet_play_motion` 且参数中的 `motion` 为 `wave`，收到结构化成功结果后再回答。展开“查看模型参数”可以直接确认原始 arguments。若模型本身不支持 tools，它可能只返回文本，这属于模型能力限制，不代表本地调度器失效。

再发送“做一个合适的表情回应我”。模型应从 `normal | blink | speak | sleep` 中选择；若首次创造 `happy` 等不存在的值，日志应显示允许列表，模型最多在本轮预算内重试，不得把失败伪装为已完成。

表情的 `durationMs` 由本地运行时负责，到时会自动恢复 `normal`。工具 schema 与成功回执都会明确要求模型不要为恢复表情再调用一次；若模型把字段误写为 `username` 等名称，本地拒绝结果会直接指出错误字段和必需的 `expression` 字段。

## 6. 关闭阶段的判定

离线 Mock 闭环与本地安全回归已经满足 M12 的产品完成门槛。真实模型验收属于具体 Provider/模型的 tool-calling 兼容性验证，不阻塞 M12；若模型只返回文本，应先确认该模型是否支持 OpenAI-compatible function calling。
