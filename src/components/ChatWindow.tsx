import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
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
import { actionRequiresConfirmation, createAgentToolDefinitions, describeActionForConfirmation } from "../domain/agent/tools";
import type { ActionRequest, ActionResult } from "../domain/actions/types";
import type { AgentCapabilitySnapshot, AgentToolExecution } from "../domain/agent/types";
import { TauriAgentActionClient } from "../controllers/TauriAgentActionClient";
import { MockChatProvider } from "../providers/MockChatProvider";
import { TauriOpenAICompatibleProvider } from "../providers/TauriOpenAICompatibleProvider";
import { MemoryController } from "../controllers/MemoryController";
import { buildMemoryContext } from "../domain/memory/types";
import type { MemoryCategory } from "../domain/memory/types";
import { memoryProposalRequiresConfirmation } from "../domain/memory/proposalPolicy";
import { insertBeforeItem, summarizeToolOnlyTurn, toolDisplayName } from "../domain/chat/toolTimeline";
import "../styles/ChatWindow.css";

export default function ChatWindow() {
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [messages, setMessages] = useState<ChatTimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [runningRequestId, setRunningRequestId] = useState<string | null>(null);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const actionClientRef = useRef(new TauriAgentActionClient());
  const confirmationRef = useRef<((allowed: boolean) => void) | null>(null);
  const memoryProposalOverrideRef = useRef(new Map<string, Extract<ActionRequest, { type: "memory.propose" }>["payload"]>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [agentCapabilities, setAgentCapabilities] = useState<AgentCapabilitySnapshot | null>(null);
  const [capabilitySyncError, setCapabilitySyncError] = useState<string | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null);
  const memoryControllerRef = useRef(new MemoryController());

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
      memoryProposalOverrideRef.current.clear();
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("agent-stop-all", () => {
      confirmationRef.current?.(false);
      confirmationRef.current = null;
      memoryProposalOverrideRef.current.clear();
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
    ? createAgentToolDefinitions(withMemoryCapability(agentCapabilities, memoryProposalsEnabled(settings))).length
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
    const conversationMessages = messages.filter(isTextMessage);
    const nextMessages = [...conversationMessages, userMessage];
    const requestId = createId("request");
    const controller = new AbortController();
    abortRef.current = controller;
    setInput("");
    setError(null);
    setRunningRequestId(requestId);
    setPendingAssistantId(assistantId);
    setMessages([...messages, userMessage, { id: assistantId, role: "assistant", content: "" }]);

    try {
      let memoryContext: string | null = null;
      if (settings.memory.enabled && settings.memory.includeInModelContext) {
        try {
          const memory = await memoryControllerRef.current.getSnapshot();
          memoryContext = buildMemoryContext(
            memory.snapshot,
            Math.min(3_000, Math.floor(settings.agent.maxContextChars * 0.25)),
          );
          setMemoryStatus(memoryContext ? `本轮使用 ${memory.snapshot.entries.length} 条明确保存的记忆` : "长期记忆已启用，但当前没有可用内容");
        } catch (memoryError) {
          setMemoryStatus(`长期记忆读取失败，本轮已按无记忆模式继续：${String(memoryError)}`);
        }
      } else {
        setMemoryStatus(settings.memory.enabled ? "本轮未向模型提供长期记忆" : null);
      }
      const memoryChars = memoryContext ? Array.from(memoryContext).length : 0;
      const providerMessages = fitMessagesToBudget(
        nextMessages,
        Math.max(1, settings.agent.maxContextChars - memoryChars),
      );
      if (memoryContext) providerMessages.unshift({ role: "system", content: memoryContext });
      let assistantText = "";
      let spokeViaTool = false;
      const turnToolExecutions: AgentToolExecution[] = [];
      const onDelta = (delta: string) => {
        assistantText += delta;
        setMessages((current) => current.map((message) =>
          message.role === "assistant" && message.id === assistantId
            ? { ...message, content: message.content + delta }
            : message
        ));
      };
      if (settings.agent.enabled) {
        const turnSnapshot = withMemoryCapability(turnCapabilities!, memoryProposalsEnabled(settings));
        await runAgentTurn({
          provider,
          messages: providerMessages,
          capabilitySnapshot: turnSnapshot,
          limits: AGENT_LIMITS,
          signal: controller.signal,
          onDelta,
          dispatch: async (action, confirmed, signal) => {
            if (action.type !== "memory.propose") {
              return actionClientRef.current.dispatch(action, confirmed, signal);
            }
            const proposal = memoryProposalOverrideRef.current.get(action.id) ?? action.payload;
            memoryProposalOverrideRef.current.delete(action.id);
            return persistMemoryProposal(action.id, proposal, confirmed, settings, memoryControllerRef.current, signal, setMemoryStatus);
          },
          confirm: requestConfirmation,
          requiresConfirmation: (action) => action.type === "memory.propose"
            ? memoryProposalRequiresConfirmation(settings.memory.proposalMode, content)
            : actionRequiresConfirmation(action.type),
          onToolExecution: (execution) => {
            turnToolExecutions.push(execution);
            if (execution.toolCall.function.name === "pet_say" && execution.result.status === "completed") {
              spokeViaTool = true;
            }
            setMessages((current) => insertBeforeItem(
              current,
              assistantId,
              { id: createId(`tool-${execution.toolCall.function.name}`), role: "tool", execution },
            ));
          },
        });
      } else {
        await provider.stream(
          { requestId, messages: providerMessages },
          { signal: controller.signal, onDelta },
        );
      }
      if (!assistantText.trim()) {
        const fallback = summarizeToolOnlyTurn(turnToolExecutions);
        assistantText = fallback;
        setMessages((current) => current.map((message) =>
          message.role === "assistant" && message.id === assistantId
            ? { ...message, content: fallback }
            : message
        ));
      }
      const spokenReply = truncateSpeechText(assistantText);
      if (
        spokenReply
        && !spokeViaTool
        && settings.speech.enabled
        && settings.speech.autoReadReplies
        && settings.audio.enabled
        && settings.audio.volume > 0
      ) {
        void emitTo("main", "speech-read-request", {
          id: `chat-speech-${assistantId}`,
          text: spokenReply,
        }).catch(() => undefined);
      }
      if (settings.memory.enabled && settings.memory.bondEnabled) {
        try {
          const award = await memoryControllerRef.current.recordCompletedInteraction(requestId);
          if (award.awarded > 0) setMemoryStatus(`羁绊 +${award.awarded}，当前 ${award.snapshot.bond.points}/100`);
          else if (award.reason === "daily_limit") setMemoryStatus("本日羁绊奖励已达到 3 次上限");
        } catch (memoryError) {
          setMemoryStatus(`羁绊记录失败：${String(memoryError)}`);
        }
      }
    } catch (caught) {
      const providerError = caught instanceof ChatProviderError || caught instanceof AgentTurnError
        ? caught
        : new ChatProviderError("internal_error", String(caught));
      if (providerError.code !== "cancelled") setError(providerError.message);
      setMessages((current) => current.filter((message) =>
        message.role === "tool" || message.id !== assistantId || message.content.trim().length > 0
      ));
    } finally {
      abortRef.current = null;
      confirmationRef.current?.(false);
      confirmationRef.current = null;
      setPendingConfirmation(null);
      setRunningRequestId(null);
      setPendingAssistantId(null);
    }
  };

  const requestConfirmation = (action: ActionRequest): Promise<boolean> =>
    new Promise((resolve) => {
      confirmationRef.current?.(false);
      confirmationRef.current = resolve;
      setPendingConfirmation({
        action,
        message: describeActionForConfirmation(action),
        proposal: action.type === "memory.propose" ? { ...action.payload } : undefined,
      });
    });

  const resolveConfirmation = (allowed: boolean) => {
    if (allowed && pendingConfirmation?.action.type === "memory.propose" && pendingConfirmation.proposal) {
      memoryProposalOverrideRef.current.set(pendingConfirmation.action.id, {
        ...pendingConfirmation.proposal,
        content: pendingConfirmation.proposal.content.trim(),
        reason: pendingConfirmation.proposal.reason.trim(),
      });
    } else if (pendingConfirmation) {
      memoryProposalOverrideRef.current.delete(pendingConfirmation.action.id);
    }
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
        <div className="chat-header-actions">
          {settings.speech.enabled && (
            <button
              type="button"
              className="chat-secondary"
              onClick={() => void emitTo("main", "speech-stop-request")}
            >
              停止朗读
            </button>
          )}
          <button type="button" className="chat-secondary" onClick={() => void invoke("open_settings")}>设置</button>
        </div>
      </header>

      <div className={isExternal ? "chat-disclosure external" : "chat-disclosure"} role="note">
        {insecureHttp && settings.agent.allowInsecureHttp
          ? "HTTP 临时测试已开启：API key、最近对话和模型回复会经网络明文传输。不会附带窗口、屏幕、应用或其他系统感知数据。"
          : isExternal
          ? "发送时会把当前输入及预算范围内的最近对话发送到配置的模型接口；不会附带窗口、屏幕、应用或其他系统感知数据。"
          : "当前使用离线 Mock Provider。输入仅在本窗口内存中处理，关闭窗口后不会保存会话。"}
      </div>
      {memoryStatus && <div className="chat-disclosure" role="status">{memoryStatus}</div>}

      <div className="chat-messages" ref={listRef} aria-live="polite" aria-busy={runningRequestId !== null}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <strong>先随便说点什么吧。</strong>
            <span>{settings.agent.enabled
              ? "可以让我招手、移动、计时，或在长期体验开启时提议记住一件事；高影响动作和自主记忆提议会先征求确认。"
              : "当前是纯文本对话；在设置中开启 Agent 后才会暴露受控语义工具。"}</span>
          </div>
        )}
        {messages.map((message) => (
          message.role === "tool"
            ? <ToolTimelineBubble key={message.id} execution={message.execution} />
            : (
              <article key={message.id} className={`chat-message ${message.role}`}>
                <span>{message.role === "user" ? "你" : "小洛宝"}</span>
                <p>{message.content || (message.id === pendingAssistantId ? "正在思考…" : "")}</p>
              </article>
            )
        ))}
      </div>

      {pendingConfirmation && (
        <section className="agent-confirmation" role="alertdialog" aria-label="确认 Agent 动作">
          <strong>需要你的确认</strong>
          <p>{pendingConfirmation.message}</p>
          {pendingConfirmation.action.type === "memory.propose" && pendingConfirmation.proposal && (
            <div className="memory-proposal-editor">
              <label>
                分类
                <select
                  value={pendingConfirmation.proposal.category}
                  onChange={(event) => updatePendingMemoryProposal(setPendingConfirmation, {
                    category: event.target.value as MemoryCategory,
                  })}
                >
                  <option value="preference">偏好</option>
                  <option value="profile">个人资料</option>
                  <option value="note">备注</option>
                </select>
              </label>
              <label>
                保存内容
                <textarea
                  rows={2}
                  maxLength={300}
                  value={pendingConfirmation.proposal.content}
                  onChange={(event) => updatePendingMemoryProposal(setPendingConfirmation, { content: event.target.value })}
                />
              </label>
              <label>
                保存原因
                <input
                  maxLength={160}
                  value={pendingConfirmation.proposal.reason}
                  onChange={(event) => updatePendingMemoryProposal(setPendingConfirmation, { reason: event.target.value })}
                />
              </label>
            </div>
          )}
          <div>
            <button type="button" className="chat-secondary" onClick={() => resolveConfirmation(false)}>拒绝</button>
            <button
              type="button"
              className="chat-send"
              disabled={pendingConfirmation.action.type === "memory.propose" && (
                !pendingConfirmation.proposal?.content.trim() || !pendingConfirmation.proposal.reason.trim()
              )}
              onClick={() => resolveConfirmation(true)}
            >{pendingConfirmation.action.type === "memory.propose" ? "确认保存" : "允许这一次"}</button>
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

function truncateSpeechText(text: string): string {
  return Array.from(text.trim()).slice(0, 500).join("");
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

function memoryProposalsEnabled(settings: PetSettings): boolean {
  return settings.memory.enabled && settings.memory.proposalMode !== "off";
}

function withMemoryCapability(
  snapshot: AgentCapabilitySnapshot,
  enabled: boolean,
): AgentCapabilitySnapshot {
  return {
    ...snapshot,
    capabilities: { ...snapshot.capabilities, memory: enabled },
  };
}

interface PendingConfirmation {
  action: ActionRequest;
  message: string;
  proposal?: Extract<ActionRequest, { type: "memory.propose" }>["payload"];
}

interface ChatToolTimelineItem {
  id: string;
  role: "tool";
  execution: AgentToolExecution;
}

type ChatTimelineItem = ChatMessage | ChatToolTimelineItem;

function isTextMessage(message: ChatTimelineItem): message is ChatMessage {
  return message.role !== "tool";
}

function ToolTimelineBubble({ execution }: { execution: AgentToolExecution }) {
  const completed = execution.result.status === "completed";
  const status = completed
    ? "已完成"
    : `未执行：${execution.result.reason ?? execution.result.errorCode ?? execution.result.status}`;
  return (
    <article className={`chat-message tool ${completed ? "completed" : "failed"}`}>
      <span>小洛宝 · 工具</span>
      <div className="chat-tool-bubble">
        <div className="chat-tool-heading">
          <strong>{toolDisplayName(execution.toolCall.function.name)}</strong>
          <span>{status}</span>
        </div>
        <code>{execution.toolCall.function.name}</code>
        <details>
          <summary>查看模型参数</summary>
          <pre>{formatToolArguments(execution.toolCall.function.arguments)}</pre>
        </details>
      </div>
    </article>
  );
}

function updatePendingMemoryProposal(
  setPending: Dispatch<SetStateAction<PendingConfirmation | null>>,
  partial: Partial<Extract<ActionRequest, { type: "memory.propose" }>["payload"]>,
): void {
  setPending((current) => current?.action.type === "memory.propose" && current.proposal
    ? { ...current, proposal: { ...current.proposal, ...partial } }
    : current);
}

async function persistMemoryProposal(
  actionId: string,
  proposal: Extract<ActionRequest, { type: "memory.propose" }>["payload"],
  confirmed: boolean,
  settings: PetSettings,
  controller: MemoryController,
  signal: AbortSignal,
  setStatus: (status: string) => void,
): Promise<ActionResult> {
  if (signal.aborted) {
    return { actionId, status: "interrupted", reason: "Agent turn 已取消", finishedAt: Date.now() };
  }
  if (!memoryProposalsEnabled(settings)) {
    return { actionId, status: "rejected", errorCode: "permission_denied", reason: "对话式记忆提议当前已关闭", finishedAt: Date.now() };
  }
  try {
    const snapshot = await controller.acceptProposal(
      proposal,
      confirmed ? "confirmed" : "explicit_request",
    );
    setStatus(`已保存模型提议的记忆，当前共 ${snapshot.entries.length} 条`);
    return { actionId, status: "completed", reason: "候选记忆已按用户策略确认并保存", finishedAt: Date.now() };
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : typeof caught === "string" ? caught : JSON.stringify(caught);
    return { actionId, status: "failed", errorCode: "memory_write_failed", reason, finishedAt: Date.now() };
  }
}
