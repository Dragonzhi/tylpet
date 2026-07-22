import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PetSettings } from "../domain/settings/types";
import { parseSettings } from "../domain/settings/validate";
import { createDefaultSettings } from "../domain/settings/defaults";
import { fitMessagesToBudget } from "../domain/chat/contextBudget";
import {
  ChatProviderError,
  type ChatMessage,
  type ChatProvider,
} from "../domain/chat/types";
import { AGENT_LIMITS } from "../config/agent";
import { AgentTurnError, runAgentTurn } from "../domain/agent/turn";
import { createAgentToolDefinitions, describeActionForConfirmation } from "../domain/agent/tools";
import type { ActionRequest } from "../domain/actions/types";
import type { AgentCapabilitySnapshot, AgentToolExecution } from "../domain/agent/types";
import { TauriAgentActionClient } from "../controllers/TauriAgentActionClient";
import { MockChatProvider } from "../providers/MockChatProvider";
import { TauriOpenAICompatibleProvider } from "../providers/TauriOpenAICompatibleProvider";
import "../styles/ChatWindow.css";

export default function ChatWindow() {
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const actionClientRef = useRef(new TauriAgentActionClient());
  const confirmationRef = useRef<((allowed: boolean) => void) | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const [toolExecutions, setToolExecutions] = useState<AgentToolExecution[]>([]);
  const [agentCapabilities, setAgentCapabilities] = useState<AgentCapabilitySnapshot | null>(null);
  const [capabilitySyncError, setCapabilitySyncError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const applyJson = (json: string | null) => {
      const result = json ? parseSettings(json) : { ok: true as const, settings: createDefaultSettings() };
      if (active) setSettings(result.ok ? result.settings : createDefaultSettings());
    };
    void invoke<string | null>("load_settings")
      .then(applyJson)
      .catch(() => applyJson(null));
    void listen<string>("settings-changed", (event) => applyJson(event.payload))
      .then((cleanup) => {
        if (active) unlisten = cleanup;
        else cleanup();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
      confirmationRef.current?.(false);
      confirmationRef.current = null;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("agent-stop-all", () => {
      confirmationRef.current?.(false);
      confirmationRef.current = null;
      setPendingConfirmation(null);
      abortRef.current?.abort();
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => undefined);
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const controller = new AbortController();
    const acceptSnapshot = (snapshot: AgentCapabilitySnapshot) => {
      if (!active) return;
      setAgentCapabilities(snapshot);
      setCapabilitySyncError(null);
    };
    const install = async () => {
      unlisten = await listen<AgentCapabilitySnapshot>("agent-capabilities-changed", (event) => {
        acceptSnapshot(event.payload);
      });
      acceptSnapshot(await actionClientRef.current.getCapabilities(controller.signal));
    };
    void install().catch((caught: unknown) => {
      if (active && !controller.signal.aborted) {
        setCapabilitySyncError(caught instanceof Error ? caught.message : String(caught));
      }
    });
    return () => {
      active = false;
      controller.abort();
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (settings && !settings.agent.enabled && runningRequestId) abortRef.current?.abort();
  }, [settings, runningRequestId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  if (!settings) {
    return <main className="chat-shell chat-loading">正在载入对话设置…</main>;
  }

  const provider = createProvider(settings);
  const isExternal = provider.external;
  const insecureHttp = isExternal && requiresInsecureHttpOptIn(settings.agent.endpoint);
  const canSend = input.trim().length > 0 && runningRequestId === null;
  const enabledToolCount = agentCapabilities
    ? createAgentToolDefinitions(agentCapabilities).length
    : 0;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || runningRequestId) return;
    if (isExternal && !settings.agent.externalDataConsent) {
      setError("请先在设置中确认允许向外部模型发送对话文本。");
      return;
    }
    if (isExternal && (!settings.agent.model.trim() || !settings.agent.endpoint.trim())) {
      setError("请先在设置中填写模型名称与接口地址。");
      return;
    }
    if (insecureHttp && !settings.agent.allowInsecureHttp) {
      setError("这是远程 HTTP 明文接口。请先在设置中开启“允许 HTTP 明文接口”。");
      return;
    }
    let turnCapabilities = agentCapabilities;
    if (settings.agent.enabled && !turnCapabilities) {
      try {
        turnCapabilities = await actionClientRef.current.getCapabilities(new AbortController().signal);
        setAgentCapabilities(turnCapabilities);
        setCapabilitySyncError(null);
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : String(caught);
        setCapabilitySyncError(reason);
        setError(`角色能力尚未同步：${reason}`);
        return;
      }
    }

    const userMessage: ChatMessage = {
      id: createId("user"),
      role: "user",
      content,
    };
    const assistantId = createId("assistant");
    const nextMessages = [...messages, userMessage];
    const requestId = createId("request");
    const controller = new AbortController();
    abortRef.current = controller;
    setInput("");
    setError(null);
    setToolExecutions([]);
    setRunningRequestId(requestId);
    setMessages([...nextMessages, { id: assistantId, role: "assistant", content: "" }]);

    try {
      const providerMessages = fitMessagesToBudget(nextMessages, settings.agent.maxContextChars);
      const onDelta = (delta: string) => {
        setMessages((current) => current.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + delta }
            : message
        ));
      };
      if (settings.agent.enabled) {
        await runAgentTurn({
          provider,
          messages: providerMessages,
          capabilitySnapshot: turnCapabilities!,
          limits: AGENT_LIMITS,
          signal: controller.signal,
          onDelta,
          dispatch: (action, confirmed, signal) =>
            actionClientRef.current.dispatch(action, confirmed, signal),
          confirm: requestConfirmation,
          onToolExecution: (execution) => {
            setToolExecutions((current) => [...current, execution]);
          },
        });
      } else {
        await provider.stream(
          { requestId, messages: providerMessages },
          { signal: controller.signal, onDelta },
        );
      }
    } catch (caught) {
      const providerError = caught instanceof ChatProviderError || caught instanceof AgentTurnError
        ? caught
        : new ChatProviderError("internal_error", String(caught));
      if (providerError.code !== "cancelled") setError(providerError.message);
      setMessages((current) => current.filter((message) =>
        message.id !== assistantId || message.content.length > 0
      ));
    } finally {
      abortRef.current = null;
      confirmationRef.current?.(false);
      confirmationRef.current = null;
      setPendingConfirmation(null);
      setRunningRequestId(null);
    }
  };

  const requestConfirmation = (action: ActionRequest): Promise<boolean> =>
    new Promise((resolve) => {
      confirmationRef.current?.(false);
      confirmationRef.current = resolve;
      setPendingConfirmation(describeActionForConfirmation(action));
    });

  const resolveConfirmation = (allowed: boolean) => {
    const resolve = confirmationRef.current;
    confirmationRef.current = null;
    setPendingConfirmation(null);
    resolve?.(allowed);
  };

  const stop = () => {
    resolveConfirmation(false);
    abortRef.current?.abort();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && runningRequestId) {
      event.preventDefault();
      stop();
    }
  };

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div>
          <h1>与小洛宝对话</h1>
          <p>{provider.id === "mock" ? "离线 Mock · 不会联网" : `外部模型 · ${settings.agent.model || "未配置模型"}`}</p>
          <span className={settings.agent.enabled ? "agent-state enabled" : "agent-state"}>
            {settings.agent.enabled
              ? agentCapabilities
                ? `Agent 工具已启用 · ${enabledToolCount} 项`
                : capabilitySyncError
                  ? "Agent 能力同步失败"
                  : "Agent 能力同步中…"
              : "纯文本对话"}
          </span>
        </div>
        <button type="button" className="chat-secondary" onClick={() => void invoke("open_settings")}>设置</button>
      </header>

      <div className={isExternal ? "chat-disclosure external" : "chat-disclosure"} role="note">
        {insecureHttp && settings.agent.allowInsecureHttp
          ? "HTTP 临时测试已开启：API key、最近对话和模型回复会经网络明文传输。不会附带窗口、屏幕、应用或其他系统感知数据。"
          : isExternal
          ? "发送时会把当前输入及预算范围内的最近对话发送到配置的模型接口；不会附带窗口、屏幕、应用或其他系统感知数据。"
          : "当前使用离线 Mock Provider。输入仅在本窗口内存中处理，关闭窗口后不会保存会话。"}
      </div>

      <div className="chat-messages" ref={listRef} aria-live="polite" aria-busy={runningRequestId !== null}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <strong>先随便说点什么吧。</strong>
            <span>{settings.agent.enabled
              ? "可以让我招手、看向某处、移动位置或开始计时；移动与取消计时会先征求确认。"
              : "当前是纯文本对话；在设置中开启 Agent 后才会暴露受控语义工具。"}</span>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`chat-message ${message.role}`}>
            <span>{message.role === "user" ? "你" : "小洛宝"}</span>
            <p>{message.content || (runningRequestId ? "正在思考…" : "")}</p>
          </article>
        ))}
      </div>

      {toolExecutions.length > 0 && (
        <div className="agent-tool-log" aria-live="polite">
          {toolExecutions.map((execution) => (
            <div className="agent-tool-entry" key={execution.toolCall.id}>
              <div className="agent-tool-summary">
                <code>{execution.toolCall.function.name}</code>
                <span className={execution.result.status === "completed" ? "ok" : "failed"}>
                  {execution.result.status === "completed" ? "已完成" : `未执行：${execution.result.reason ?? execution.result.errorCode ?? execution.result.status}`}
                </span>
              </div>
              <details>
                <summary>查看模型参数</summary>
                <pre>{formatToolArguments(execution.toolCall.function.arguments)}</pre>
              </details>
            </div>
          ))}
        </div>
      )}

      {pendingConfirmation && (
        <section className="agent-confirmation" role="alertdialog" aria-label="确认 Agent 动作">
          <strong>需要你的确认</strong>
          <p>{pendingConfirmation}</p>
          <div>
            <button type="button" className="chat-secondary" onClick={() => resolveConfirmation(false)}>拒绝</button>
            <button type="button" className="chat-send" onClick={() => resolveConfirmation(true)}>允许这一次</button>
          </div>
        </section>
      )}

      {error && <div className="chat-error" role="alert">{error}</div>}

      <form className="chat-composer" onSubmit={(event) => void submit(event)}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onInputKeyDown}
          maxLength={20_000}
          rows={3}
          placeholder="输入消息；Enter 发送，Shift+Enter 换行"
          aria-label="对话消息"
          disabled={runningRequestId !== null}
        />
        <div className="chat-actions">
          <span>{Array.from(input).length}/20000</span>
          {runningRequestId ? (
            <button type="button" className="chat-stop" onClick={stop}>停止生成</button>
          ) : (
            <button type="submit" className="chat-send" disabled={!canSend}>发送</button>
          )}
        </div>
      </form>
    </main>
  );
}

function createProvider(settings: PetSettings): ChatProvider {
  if (settings.agent.provider === "openai-compatible") {
    return new TauriOpenAICompatibleProvider({
      endpoint: settings.agent.endpoint.trim(),
      model: settings.agent.model.trim(),
      timeoutMs: settings.agent.timeoutMs,
      maxRetries: settings.agent.maxRetries,
      allowInsecureHttp: settings.agent.allowInsecureHttp,
    });
  }
  return new MockChatProvider();
}

function createId(prefix: string): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function requiresInsecureHttpOptIn(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:"
      && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function formatToolArguments(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw || "（空参数）";
  }
}
