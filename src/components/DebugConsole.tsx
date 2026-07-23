import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePetRuntime } from "../hooks/usePetRuntime";
import { PROTOCOL_VERSION } from "../domain/actions/types";
import type {
  ActionType,
  ActionSource,
  WindowSemanticPosition,
} from "../domain/actions/types";
import { validateActionRequest, type ValidationResult } from "../domain/validation/validate";
import {
  getDefaultChannel,
  getDefaultPriority,
} from "../domain/scheduler/channelPolicy";
import type {
  ActiveAction,
  PendingAction,
  Priority,
  SchedulerEvent,
  SubmitOptions,
} from "../domain/scheduler/types";
import type { CapabilitySet } from "../domain/capabilities/capabilities";
import { WINDOW_MOVE_CONFIG } from "../config/windowMove";
import { OBSERVATION_PROTOCOL_VERSION, type ObservationIngestResult } from "../domain/observations/types";
import "../styles/DebugConsole.css";

const ACTION_TYPES: ActionType[] = [
  "motion.play",
  "expression.set",
  "look.set",
  "window.move",
  "outfit.equip",
  "speech.say",
  "timer.start",
  "timer.pause",
  "timer.resume",
  "timer.cancel",
  "wait",
];

const SOURCES: ActionSource[] = ["user", "agent", "timer", "system", "dev"];

const PRIORITIES: (Priority | "auto")[] = [
  "auto",
  "safety-stop",
  "user",
  "menu",
  "timer",
  "agent",
  "idle",
];

const SEMANTIC_POSITIONS: WindowSemanticPosition[] = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

interface FormState {
  motionName: string;
  motionSpeed: string;
  expressionName: string;
  expressionDuration: string;
  lookX: string;
  lookY: string;
  windowKind: "semantic" | "normalized";
  windowPosition: WindowSemanticPosition;
  windowX: string;
  windowY: string;
  windowDuration: string;
  outfitId: string;
  speechText: string;
  speechInterrupt: boolean;
  timerDuration: string;
  timerLabel: string;
  timerId: string;
  waitDuration: string;
}

function defaultFormState(): FormState {
  return {
    motionName: "wave",
    motionSpeed: "",
    expressionName: "normal",
    expressionDuration: "",
    lookX: "0",
    lookY: "0",
    windowKind: "semantic",
    windowPosition: "center",
    windowX: "0.5",
    windowY: "0.5",
    windowDuration: "",
    outfitId: "",
    speechText: "",
    speechInterrupt: true,
    timerDuration: "1000",
    timerLabel: "",
    timerId: "",
    waitDuration: "1000",
  };
}

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 12)}…`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function eventClassName(type: SchedulerEvent["type"]): string {
  return `event-type event-${type}`;
}

function buildPayload(
  type: ActionType,
  form: FormState,
): Record<string, unknown> {
  switch (type) {
    case "motion.play": {
      const payload: Record<string, unknown> = { motion: form.motionName };
      const speed = parseFloat(form.motionSpeed);
      if (!Number.isNaN(form.motionSpeed) && form.motionSpeed !== "") {
        payload.speed = speed;
      }
      return payload;
    }
    case "expression.set": {
      const payload: Record<string, unknown> = {
        expression: form.expressionName,
      };
      const durationMs = parseFloat(form.expressionDuration);
      if (
        !Number.isNaN(form.expressionDuration) &&
        form.expressionDuration !== ""
      ) {
        payload.durationMs = durationMs;
      }
      return payload;
    }
    case "look.set":
      return { x: parseFloat(form.lookX), y: parseFloat(form.lookY) };
    case "window.move": {
      const payload: Record<string, unknown> = {};
      if (form.windowKind === "semantic") {
        payload.target = {
          kind: "semantic",
          position: form.windowPosition,
        };
      } else {
        payload.target = {
          kind: "normalized",
          x: parseFloat(form.windowX),
          y: parseFloat(form.windowY),
        };
      }
      const durationMs = parseFloat(form.windowDuration);
      if (
        !Number.isNaN(form.windowDuration) &&
        form.windowDuration !== ""
      ) {
        payload.durationMs = durationMs;
      }
      return payload;
    }
    case "outfit.equip":
      return { outfitId: form.outfitId };
    case "speech.say":
      return { text: form.speechText, interrupt: form.speechInterrupt };
    case "memory.propose":
      return { category: "note", content: "调试候选", reason: "调试控制台占位" };
    case "timer.start": {
      const payload: Record<string, unknown> = {
        durationMs: parseFloat(form.timerDuration),
      };
      if (form.timerLabel.trim() !== "") {
        payload.label = form.timerLabel.trim();
      }
      return payload;
    }
    case "timer.pause":
    case "timer.resume":
      return { timerId: form.timerId };
    case "timer.cancel":
      return { timerId: form.timerId };
    case "media.react":
      return { state: "stopped" };
    case "wait":
      return { durationMs: parseFloat(form.waitDuration) };
  }
}

function buildRawInput(
  type: ActionType,
  form: FormState,
  source: ActionSource,
): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: `debug-${Date.now()}`,
    type,
    source,
    requestedAt: Date.now(),
    payload: buildPayload(type, form),
  };
}

export default function DebugConsole(): ReactNode {
  const { scheduler, capabilities, observationHost } = usePetRuntime();
  const capabilitySet = useMemo<CapabilitySet>(
    () => ({
      renderer: capabilities,
      window: true,
      speech: false,
      timer: true,
    }),
    [capabilities],
  );

  // 角色窗口只有 400px 宽；默认收起，避免开发面板加载后遮住角色。
  const [collapsed, setCollapsed] = useState(true);
  const [selectedType, setSelectedType] = useState<ActionType>("motion.play");
  const [source, setSource] = useState<ActionSource>("dev");
  const [priority, setPriority] = useState<Priority | "auto">("auto");
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [activeActions, setActiveActions] = useState<readonly ActiveAction[]>(
    [],
  );
  const [pendingActions, setPendingActions] = useState<
    readonly PendingAction[]
  >([]);
  const [events, setEvents] = useState<SchedulerEvent[]>([]);
  const [agentPaused, setAgentPaused] = useState(false);
  const [observationResult, setObservationResult] = useState<ObservationIngestResult | null>(null);

  useEffect(() => {
    const unsubscribe = scheduler.onEvent((event) => {
      setEvents((prev) => [...prev, event].slice(-50));
      setActiveActions([...scheduler.getActiveActions()]);
      setPendingActions([...scheduler.getPendingActions()]);
    });
    setActiveActions([...scheduler.getActiveActions()]);
    setPendingActions([...scheduler.getPendingActions()]);
    return unsubscribe;
  }, [scheduler]);

  const updateField = <K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submitAction = (
    type: ActionType,
    payload: Record<string, unknown>,
    actionSource: ActionSource,
    actionPriority?: Priority,
  ) => {
    const rawInput: Record<string, unknown> = {
      protocolVersion: PROTOCOL_VERSION,
      id: `debug-${type}-${Date.now()}`,
      type,
      source: actionSource,
      requestedAt: Date.now(),
      payload,
    };
    const result = validateActionRequest(rawInput, {
      capabilities: capabilitySet,
    });
    if (result.ok) {
      const channel = getDefaultChannel(result.action.type) ?? "timer";
      const options: SubmitOptions = { channel };
      if (actionPriority !== undefined) {
        options.priority = actionPriority;
      }
      if (type === "window.move") {
        options.cooldownMs = WINDOW_MOVE_CONFIG.minIntervalMs;
      }
      scheduler.submit(result.action, options);
      if (result.action.type === "timer.start") {
        updateField("timerId", result.action.id);
      }
    }
    setValidationResult(result);
  };

  const handleSubmit = () => {
    const rawInput = buildRawInput(selectedType, form, source);
    const result = validateActionRequest(rawInput, {
      capabilities: capabilitySet,
    });
    if (result.ok) {
      const channel = getDefaultChannel(result.action.type) ?? "timer";
      const options: SubmitOptions = { channel };
      if (priority !== "auto") {
        options.priority = priority;
      }
      if (result.action.type === "window.move") {
        options.cooldownMs = WINDOW_MOVE_CONFIG.minIntervalMs;
      }
      scheduler.submit(result.action, options);
    }
    setValidationResult(result);
  };

  const handleCancel = (actionId: string) => {
    scheduler.cancel(actionId);
  };

  const handleCancelAll = () => {
    scheduler.cancelAll();
  };

  const handleCancelLocomotion = () => {
    scheduler.cancelChannel("locomotion");
  };

  const handleToggleAgentPause = () => {
    if (agentPaused) {
      scheduler.resumeAgentActions();
      setAgentPaused(false);
    } else {
      scheduler.pauseAgentActions();
      setAgentPaused(true);
    }
  };

  const submitObservation = (
    type: "dev-agent.status" | "media.playback",
    state: string,
  ) => {
    const result = observationHost.ingest({
      protocolVersion: OBSERVATION_PROTOCOL_VERSION,
      id: `debug-observation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      source: { kind: "system", id: "debug-console" },
      type,
      observedAt: Date.now(),
      sensitivity: "status",
      payload: { state },
    });
    setObservationResult(result);
  };

  const renderPayloadForm = () => {
    switch (selectedType) {
      case "motion.play":
        return (
          <>
            <div className="debug-row">
              <label className="debug-label" htmlFor="motion-name">
                motion
              </label>
              <input
                id="motion-name"
                className="debug-input"
                type="text"
                value={form.motionName}
                onChange={(e) => updateField("motionName", e.target.value)}
                placeholder="wave"
              />
            </div>
            <div className="debug-row">
              <label className="debug-label" htmlFor="motion-speed">
                speed
              </label>
              <input
                id="motion-speed"
                className="debug-input"
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={form.motionSpeed}
                onChange={(e) => updateField("motionSpeed", e.target.value)}
                placeholder="0-10"
              />
            </div>
          </>
        );
      case "expression.set":
        return (
          <>
            <div className="debug-row">
              <label className="debug-label" htmlFor="expression-name">
                expression
              </label>
              <input
                id="expression-name"
                className="debug-input"
                type="text"
                value={form.expressionName}
                onChange={(e) => updateField("expressionName", e.target.value)}
                placeholder="normal"
              />
            </div>
            <div className="debug-row">
              <label className="debug-label" htmlFor="expression-duration">
                durationMs
              </label>
              <input
                id="expression-duration"
                className="debug-input"
                type="number"
                min="0"
                step="1"
                value={form.expressionDuration}
                onChange={(e) =>
                  updateField("expressionDuration", e.target.value)
                }
                placeholder="可选"
              />
            </div>
          </>
        );
      case "look.set":
        return (
          <>
            <div className="debug-row">
              <label className="debug-label" htmlFor="look-x">
                x
              </label>
              <input
                id="look-x"
                className="debug-input"
                type="number"
                min="-1"
                max="1"
                step="0.1"
                value={form.lookX}
                onChange={(e) => updateField("lookX", e.target.value)}
              />
            </div>
            <div className="debug-row">
              <label className="debug-label" htmlFor="look-y">
                y
              </label>
              <input
                id="look-y"
                className="debug-input"
                type="number"
                min="-1"
                max="1"
                step="0.1"
                value={form.lookY}
                onChange={(e) => updateField("lookY", e.target.value)}
              />
            </div>
          </>
        );
      case "window.move":
        return (
          <>
            <div className="debug-row">
              <label className="debug-label" htmlFor="window-kind">
                target
              </label>
              <select
                id="window-kind"
                className="debug-select"
                value={form.windowKind}
                onChange={(e) =>
                  updateField(
                    "windowKind",
                    e.target.value as "semantic" | "normalized",
                  )
                }
              >
                <option value="semantic">semantic</option>
                <option value="normalized">normalized</option>
              </select>
            </div>
            {form.windowKind === "semantic" ? (
              <div className="debug-row">
                <label className="debug-label" htmlFor="window-position">
                  position
                </label>
                <select
                  id="window-position"
                  className="debug-select"
                  value={form.windowPosition}
                  onChange={(e) =>
                    updateField(
                      "windowPosition",
                      e.target.value as WindowSemanticPosition,
                    )
                  }
                >
                  {SEMANTIC_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="debug-row">
                  <label className="debug-label" htmlFor="window-x">
                    x
                  </label>
                  <input
                    id="window-x"
                    className="debug-input"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={form.windowX}
                    onChange={(e) => updateField("windowX", e.target.value)}
                  />
                </div>
                <div className="debug-row">
                  <label className="debug-label" htmlFor="window-y">
                    y
                  </label>
                  <input
                    id="window-y"
                    className="debug-input"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={form.windowY}
                    onChange={(e) => updateField("windowY", e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="debug-row">
              <label className="debug-label" htmlFor="window-duration">
                durationMs
              </label>
              <input
                id="window-duration"
                className="debug-input"
                type="number"
                min="0"
                max="10000"
                step="100"
                value={form.windowDuration}
                onChange={(e) =>
                  updateField("windowDuration", e.target.value)
                }
                placeholder="可选"
              />
            </div>
          </>
        );
      case "outfit.equip":
        return (
          <div className="debug-row">
            <label className="debug-label" htmlFor="outfit-id">
              outfitId
            </label>
            <input
              id="outfit-id"
              className="debug-input"
              type="text"
              value={form.outfitId}
              onChange={(e) => updateField("outfitId", e.target.value)}
              placeholder="服装 ID"
            />
          </div>
        );
      case "speech.say":
        return (
          <>
            <div className="debug-row">
              <label className="debug-label" htmlFor="speech-text">
                text
              </label>
              <textarea
                id="speech-text"
                className="debug-textarea"
                value={form.speechText}
                onChange={(e) => updateField("speechText", e.target.value)}
                placeholder="想说的话"
              />
            </div>
            <div className="debug-row">
              <label className="debug-checkbox">
                <input
                  type="checkbox"
                  checked={form.speechInterrupt}
                  onChange={(e) =>
                    updateField("speechInterrupt", e.target.checked)
                  }
                />
                interrupt
              </label>
            </div>
          </>
        );
      case "timer.start":
        return (
          <>
            <div className="debug-row">
              <label className="debug-label" htmlFor="timer-duration">
                durationMs
              </label>
              <input
                id="timer-duration"
                className="debug-input"
                type="number"
                min="1"
                step="1"
                value={form.timerDuration}
                onChange={(e) =>
                  updateField("timerDuration", e.target.value)
                }
              />
            </div>
            <div className="debug-row">
              <label className="debug-label" htmlFor="timer-label">
                label
              </label>
              <input
                id="timer-label"
                className="debug-input"
                type="text"
                value={form.timerLabel}
                onChange={(e) => updateField("timerLabel", e.target.value)}
                placeholder="可选"
              />
            </div>
          </>
        );
      case "timer.pause":
      case "timer.resume":
      case "timer.cancel":
        return (
          <div className="debug-row">
            <label className="debug-label" htmlFor="timer-id">
              timerId
            </label>
            <input
              id="timer-id"
              className="debug-input"
              type="text"
              value={form.timerId}
              onChange={(e) => updateField("timerId", e.target.value)}
            />
          </div>
        );
      case "wait":
        return (
          <div className="debug-row">
            <label className="debug-label" htmlFor="wait-duration">
              durationMs
            </label>
            <input
              id="wait-duration"
              className="debug-input"
              type="number"
              min="0"
              step="1"
              value={form.waitDuration}
              onChange={(e) => updateField("waitDuration", e.target.value)}
            />
          </div>
        );
    }
  };

  return (
    <div
      className={`debug-console${collapsed ? " is-collapsed" : ""}`}
      aria-label="动作控制台"
      data-click-through-interactive
    >
      <div className="debug-console-header">
        <div className="debug-console-title">动作控制台</div>
        <button
          className="debug-console-toggle"
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? "展开" : "收起"}
          title={collapsed ? "展开" : "收起"}
        >
          {collapsed ? "◀" : "▶"}
        </button>
      </div>

      <div className="debug-console-scroll">
        {/* Action Submission */}
        <section className="debug-section">
          <div className="debug-section-title">提交动作</div>
          <div className="debug-row">
            <label className="debug-label" htmlFor="action-type">
              type
            </label>
            <select
              id="action-type"
              className="debug-select"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as ActionType)}
            >
              {ACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {renderPayloadForm()}

          <div className="debug-row">
            <label className="debug-label" htmlFor="action-source">
              source
            </label>
            <select
              id="action-source"
              className="debug-select"
              value={source}
              onChange={(e) => setSource(e.target.value as ActionSource)}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="debug-row">
            <label className="debug-label" htmlFor="action-priority">
              priority
            </label>
            <select
              id="action-priority"
              className="debug-select"
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as Priority | "auto")
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="debug-row">
            <button
              className="debug-btn debug-btn-primary"
              type="button"
              onClick={handleSubmit}
            >
              提交动作
            </button>
          </div>

          {priority === "auto" && (
            <div className="debug-row">
              <span className="debug-label" />
              <span className="action-meta">
                默认优先级: {getDefaultPriority(source)}
              </span>
            </div>
          )}

          {validationResult && (
            <div
              className={`validation-box ${
                validationResult.ok ? "validation-ok" : "validation-error"
              }`}
            >
              {validationResult.ok
                ? `✓ 验证通过，默认通道: ${getDefaultChannel(
                    validationResult.action.type,
                  ) ?? "timer"}`
                : `✗ ${validationResult.reason}`}
            </div>
          )}
        </section>

        {/* Quick Scripts */}
        <section className="debug-section">
          <div className="debug-section-title">快速脚本</div>
          <div className="script-row">
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction("motion.play", { motion: "wave" }, "user")
              }
            >
              招手
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction("look.set", { x: -0.5, y: -0.5 }, "dev")
              }
            >
              看向左上
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction("look.set", { x: 0.5, y: 0.5 }, "dev")
              }
            >
              看向右下
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction("look.set", { x: 0, y: 0 }, "dev")
              }
            >
              恢复视线
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction(
                  "expression.set",
                  { expression: "blink", durationMs: 200 },
                  "dev",
                )
              }
            >
              眨眼
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction("wait", { durationMs: 1000 }, "dev")
              }
            >
              等待1秒
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction(
                  "window.move",
                  {
                    target: { kind: "semantic", position: "center" },
                  },
                  "user",
                )
              }
            >
              回到中央
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction(
                  "window.move",
                  {
                    target: { kind: "semantic", position: "top-left" },
                  },
                  "dev",
                )
              }
            >
              移到左上
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction(
                  "window.move",
                  {
                    target: { kind: "semantic", position: "top-right" },
                  },
                  "dev",
                )
              }
            >
              移到右上
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction(
                  "window.move",
                  {
                    target: { kind: "semantic", position: "bottom-left" },
                  },
                  "dev",
                )
              }
            >
              移到左下
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={() =>
                submitAction(
                  "window.move",
                  {
                    target: { kind: "semantic", position: "bottom-right" },
                  },
                  "dev",
                )
              }
            >
              移到右下
            </button>
          </div>
        </section>

        {/* Controls */}
        <section className="debug-section">
          <div className="debug-section-title">控制</div>
          <div className="debug-row wrap">
            <button
              className="debug-btn debug-btn-danger"
              type="button"
              onClick={handleCancelAll}
            >
              取消全部
            </button>
            <button
              className="debug-btn debug-btn-warning"
              type="button"
              onClick={handleToggleAgentPause}
            >
              {agentPaused ? "恢复 Agent" : "暂停 Agent"}
            </button>
            <button
              className="debug-btn"
              type="button"
              onClick={handleCancelLocomotion}
            >
              取消 locomotion
            </button>
          </div>
        </section>

        {/* Capabilities */}
        <section className="debug-section">
          <div className="debug-section-title">能力集</div>
          <div className="capability-grid">
            <span className="capability-key">motions</span>
            <span className="capability-value">
              {capabilities.motions.join(", ") || "无"}
            </span>
            <span className="capability-key">expressions</span>
            <span className="capability-value">
              {capabilities.expressions.join(", ") || "无"}
            </span>
            <span className="capability-key">lookDirection</span>
            <span className="capability-value">
              {capabilities.lookDirection ? "true" : "false"}
            </span>
            <span className="capability-key">outfits</span>
            <span className="capability-value">
              {capabilities.outfits.join(", ") || "无"}
            </span>
            <span className="capability-key">window</span>
            <span className="capability-value">
              {capabilitySet.window ? "true" : "false"}
            </span>
            <span className="capability-key">speech</span>
            <span className="capability-value">
              {capabilitySet.speech ? "true" : "false"}
            </span>
            <span className="capability-key">timer</span>
            <span className="capability-value">
              {capabilitySet.timer ? "true" : "false"}
            </span>
          </div>
        </section>

        {/* Active Actions */}
        <section className="debug-section">
          <div className="debug-section-title">
            运行中 ({activeActions.length})
          </div>
          {activeActions.length === 0 ? (
            <div className="empty-list">暂无运行中动作</div>
          ) : (
            <div className="action-list">
              {activeActions.map((action) => (
                <div key={action.actionId} className="action-item">
                  <div className="action-info">
                    <div className="action-main">
                      <span className="action-type">{action.action.type}</span>
                      <span className="action-id">
                        {truncateId(action.actionId)}
                      </span>
                    </div>
                    <div className="action-meta">
                      {action.channel} · {action.priority} · started{" "}
                      {formatTime(action.startedAt)}
                    </div>
                  </div>
                  <button
                    className="debug-btn debug-btn-danger"
                    type="button"
                    onClick={() => handleCancel(action.actionId)}
                  >
                    取消
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Pending Queue */}
        <section className="debug-section">
          <div className="debug-section-title">
            等待队列 ({pendingActions.length})
          </div>
          {pendingActions.length === 0 ? (
            <div className="empty-list">队列为空</div>
          ) : (
            <div className="action-list">
              {pendingActions.map((action) => (
                <div key={action.actionId} className="action-item">
                  <div className="action-info">
                    <div className="action-main">
                      <span className="action-type">{action.action.type}</span>
                      <span className="action-id">
                        {truncateId(action.actionId)}
                      </span>
                    </div>
                    <div className="action-meta">
                      {action.channel} · {action.priority} · submitted{" "}
                      {formatTime(action.submittedAt)}
                    </div>
                  </div>
                  <button
                    className="debug-btn debug-btn-danger"
                    type="button"
                    onClick={() => handleCancel(action.actionId)}
                  >
                    取消
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="debug-section">
          <div className="debug-section-title">M13 观察事件</div>
          <div className="debug-row">
            <button className="debug-btn" type="button" onClick={() => submitObservation("dev-agent.status", "waiting_for_user")}>等待用户</button>
            <button className="debug-btn" type="button" onClick={() => submitObservation("dev-agent.status", "completed")}>任务完成</button>
            <button className="debug-btn" type="button" onClick={() => submitObservation("dev-agent.status", "failed")}>任务失败</button>
          </div>
          <div className="debug-row">
            <button className="debug-btn" type="button" onClick={() => submitObservation("media.playback", "playing")}>模拟媒体播放</button>
            <button className="debug-btn" type="button" onClick={() => submitObservation("media.playback", "paused")}>模拟媒体暂停</button>
            <button className="debug-btn" type="button" onClick={() => submitObservation("media.playback", "stopped")}>模拟媒体停止</button>
          </div>
          <div className="action-meta">
            {observationResult
              ? `${observationResult.status} · ${observationResult.status === "rejected" ? observationResult.reason : observationResult.eventId}`
              : "请先在设置中开启“允许外部状态触发角色反应”"}
          </div>
          <div className="action-meta">脱敏诊断：{observationHost.getDiagnostics().length} 条（不含 payload）</div>
        </section>

        {/* Event Log */}
        <section className="debug-section">
          <div className="debug-section-title">事件日志 ({events.length})</div>
          <div className="event-log">
            {events.length === 0 ? (
              <div className="empty-list">暂无事件</div>
            ) : (
              events.map((event, index) => (
                <div key={index} className="event-item">
                  <span className="event-time">{formatTime(event.timestamp)}</span>
                  <span className={eventClassName(event.type)}>{event.type}</span>
                  <span className="event-detail">
                    {truncateId(event.actionId)} · {event.actionType}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
