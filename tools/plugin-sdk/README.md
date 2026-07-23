# Tylpet 创作者插件 SDK（协议 v1）

首版 SDK 是声明式协议、JSON Schema、类型声明和 Mock Host，不是可在桌宠进程中运行的代码 SDK。插件只需生成受支持的生命周期状态，再调用主程序自带的 `tylpet emit`；它不会获得 WebView、Tauri command、窗口控制或模型密钥。清单文件名 `ltypet.plugin.json` 是 v1 兼容标识，暂不随产品更名破坏性调整。

```powershell
node tools/plugin-sdk/mock-host.mjs examples/plugins/dev-agent-hooks/ltypet.plugin.json dev-agent.status completed
```

正式接入流程：在设置页检查并确认安装 manifest，取得界面显示的 `credential.v1.json` 路径，然后让受信任的本机 hook 调用：

```powershell
src-tauri\target\debug\tylpet.exe emit --credential "<credential.v1.json>" --type dev-agent.status --state completed
```

Schema 位于 `docs/plugin/`。宿主还会校验凭据、启用状态、权限、8 KiB 请求上限和每插件每分钟 20 个事件的预算。
