# dev-agent-hooks 示例插件

这个示例把 Codex、Claude Code 或其他开发 Agent 可用的生命周期 hook 转成 Tylpet 当前角色小洛宝可理解的状态。它只传以下枚举值：

- `session_started`
- `working`
- `waiting_for_user`
- `completed`
- `failed`
- `stopped`

它不会传代码、文件内容、prompt、工具参数、终端输出或工作区名称。

## 安装与测试

1. 启动桌宠，打开“设置 → 创作者插件”。
2. 输入本目录 `ltypet.plugin.json` 的完整路径，点击“检查 manifest”。
3. 核对事件权限只有 `dev-agent.status`、敏感级别只有 `status`，再确认安装。
4. 复制已安装插件卡片中的凭据路径。
5. 先用 Mock Host 验证声明，再向正在运行的桌宠提交事件：

```powershell
node tools/plugin-sdk/mock-host.mjs examples/plugins/dev-agent-hooks/ltypet.plugin.json dev-agent.status completed

examples\plugins\dev-agent-hooks\emit.ps1 `
  -State completed `
  -Credential "C:\\...\\plugins\\dev-agent-hooks\\credential.v1.json"
```

把同一条 PowerShell 调用放入工具提供的生命周期 hook 即可。工具之间的 hook 配置格式会变化，本仓库不伪造或读取它们的内部会话；适配器只需在确定的生命周期节点传一个固定枚举值。

禁用或卸载插件后，相同命令会被宿主拒绝。主程序重启时回环地址会变化，但凭据文件会自动重写，因此 hook 应每次读取文件，不要缓存其中的 token 或 address。
