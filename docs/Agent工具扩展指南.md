# Agent 工具扩展指南

> 适用范围：M12 之后为桌宠增加新的模型可调用能力。
>
> 核心原则：模型只负责选择语义动作；真实能力、参数校验、授权、调度和执行结果始终由本地代码决定。

## 1. 当前数据流

1. 主窗口从 `CharacterRenderer` 和原生控制器收集真实能力，生成 `AgentCapabilitySnapshot`。
2. 聊天窗口在 Agent turn 开始前固定一份快照。
3. `src/domain/agent/tools.ts` 的工具注册表按快照生成 OpenAI-compatible tools；无能力的工具不会发送给模型。
4. 模型 tool call 由同一注册表映射为 M1 `ActionRequest`，先做参数和能力校验。
5. `AgentRuntimeBridge` 在主窗口再次校验白名单、最新能力、Agent 开关、确认、频率和冷却，然后提交 `BehaviorScheduler`。
6. 只有调度器真实终态会作为 `ActionResult` 返回模型。

能力快照是“给模型看的本轮目录”，不是授权凭证。主窗口的第二次校验不可删除，因为素材、设置或运行状态可能在一轮期间变化。

## 2. 只增加动作或表情素材

如果只是新增一个已经由现有渲染器支持的命名动作或表情：

1. 在角色 canonical `motions.v1.json` 或渲染器表情能力中加入稳定英文 ID。
2. 确认 `RendererCapabilities.motions` / `expressions` 会报告该 ID。
3. 可在 `src/domain/agent/tools.ts` 的中文标签表补充释义；未知 ID 仍会原样进入 enum，不会阻塞运行。
4. 增加“能力 enum 包含新 ID → tool call 映射成功 → 调度器执行”的测试。
5. 用真实 Tauri 窗口验证动作结束、打断、冷却和 reduced motion 行为。

这一类改动不应新增新的 tool name。例如 `wave`、`bow`、`stretch` 都属于 `pet_play_motion` 的不同 enum 值。

## 3. 增加一种全新的 Agent 能力

必须完成下面的纵向链路，不能只写提示词或只增加 tool schema：

| 层 | 必做改动 |
|---|---|
| M1 语义协议 | 在 `src/domain/actions/types.ts` 定义稳定 Action 类型与 payload，不暴露 DOM、shell、原始 command 或实现细节 |
| 参数校验 | 在 `src/domain/validation/validate.ts` 增加边界、默认值和错误码测试 |
| 能力模型 | 在 `src/domain/capabilities/capabilities.ts` 声明真实可用条件，并由实际控制器报告 |
| 工具适配 | 在 `src/domain/agent/tools.ts` 注册可用条件、schema、语义描述和 Action 映射 |
| Provider 原生边界 | 更新 `src-tauri/src/chat.rs` 的 tool name 白名单及 Rust 拒绝测试 |
| 主窗口授权 | 更新 `AgentRuntimeBridge` 的显式 Action 白名单；高影响动作接入逐次确认 |
| 调度执行 | 为动作选择通道、优先级、中断规则、超时和冷却；不得从聊天组件直接操作角色或窗口 |
| 可观察性 | 工具日志只显示必要参数和结构化结果，不记录 API key 或隐私数据 |
| 验证与文档 | 覆盖成功、参数错误、能力缺失、拒绝、取消、超时和模型重试；更新 `HANDBOOK.md` 与 M12 验收记录 |

新增工具后，`AgentToolName`、Rust 白名单和主窗口白名单仍保持显式枚举。这些看似重复的门是不同信任边界的纵深防御，不应通过通配符合并。

## 4. Schema 与提示编写约定

- 有有限集合的参数必须用 JSON Schema `enum`，不要仅在 description 中举例。
- enum 使用稳定英文 ID；description 可附中文含义，明确要求模型逐字选择。
- 无真实能力时隐藏整个工具，不发送“调用后必然失败”的占位工具。
- 参数保持语义化。例如窗口工具使用 `right`，不向模型提供物理像素或 Tauri API。
- 错误结果应告诉模型如何修正，但不得把未知文本解释成最接近的本地动作。
- 工具 schema 不承载秘密、权限或用户确认状态；这些由本地策略控制。

## 5. 资源型能力的下一步

动作和表情适合用能力快照中的 enum。计时器、播放列表、服装等会随运行变化的资源，后续应在快照中增加只读资源摘要（稳定 ID、用户可见名称、必要状态），再由注册表生成 enum。不要让模型猜测 `timerId`、文件路径或内部数据库键。

若资源数量可能很大，应改为受控的“列出资源 → 选择稳定 ID”两步工具，并设置条数和字符预算，不能把无界数据全部塞进 prompt。

## 6. 完成门槛

- Agent 关闭、能力同步失败或 Provider 断网时，基础桌宠与纯文本对话正常。
- 模型看不到当前不可用工具，有限参数看到精确 enum。
- 模型创造参数、重复调用或提示注入时，本地拒绝且不产生副作用。
- 用户拖动、菜单、安全停止和退出仍高于 Agent 动作。
- 自动化检查通过；窗口、DPI、菜单、拖动或系统能力相关改动完成真实 Tauri 验证。
