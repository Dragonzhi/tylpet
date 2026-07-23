import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  PetSettings,
  WindowSettings,
  AnimationSettings,
  AudioSettings,
  SpeechSettings,
  AgentSettings,
  PomodoroSettings,
  ObservationSettings,
  MemorySettings,
} from "../domain/settings/types";
import type { SpeechVoice, TimerKind, TimerSnapshot } from "../domain/controllers/types";
import { TauriTimerController } from "../controllers/TauriTimerController";
import { parseSettings } from "../domain/settings/validate";
import { createDefaultSettings } from "../domain/settings/defaults";
import { deleteApiKey, hasApiKey, setApiKey } from "../controllers/SecureKeyStore";
import PluginSettingsPanel from "./PluginSettingsPanel";
import MemorySettingsPanel from "./MemorySettingsPanel";

export default function SettingsWindow() {
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timer, setTimer] = useState<TimerSnapshot | null>(null);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [timerController] = useState(() => new TauriTimerController());
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyPresent, setApiKeyPresent] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<string | null>(null);
  const [speechVoices, setSpeechVoices] = useState<SpeechVoice[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const json = await invoke<string | null>("load_settings");
        if (json) {
          const result = parseSettings(json);
          if (result.ok) {
            setSettings(result.settings);
            return;
          }
          setLoadError(result.reason);
        }
        setSettings(createDefaultSettings());
      } catch (err) {
        setLoadError(String(err));
        setSettings(createDefaultSettings());
      }
    })();
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      setSpeechVoices(window.speechSynthesis.getVoices()
        .filter((voice) => voice.localService)
        .map((voice) => ({
          id: voice.voiceURI,
          name: voice.name,
          language: voice.lang,
          local: voice.localService,
        })));
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void listen<string>("settings-changed", (event) => {
      const result = parseSettings(event.payload);
      if (active && result.ok) setSettings(result.settings);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void timerController.getState().then((state) => {
      if (active) setTimer(state);
    }).catch((error: unknown) => {
      if (active) setTimerError(String(error));
    });
    void timerController.onStateChange((event) => {
      if (active) setTimer(event.timer);
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((error: unknown) => {
      if (active) setTimerError(String(error));
    });
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => {
      active = false;
      unsubscribe?.();
      window.clearInterval(interval);
    };
  }, [timerController]);

  useEffect(() => {
    if (settings?.agent.provider !== "openai-compatible") {
      setApiKeyPresent(false);
      return;
    }
    let active = true;
    void hasApiKey("openai-compatible")
      .then((present) => {
        if (active) setApiKeyPresent(present);
      })
      .catch((error: unknown) => {
        if (active) setApiKeyStatus(`检查 API key 失败：${String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [settings?.agent.provider]);

  if (!settings) {
    return (
      <div style={containerStyle}>
        <div style={{ padding: 24 }}>加载中...</div>
      </div>
    );
  }

  const save = async (next: PetSettings) => {
    setSettings(next);
    try {
      const json = JSON.stringify(next, null, 2);
      await invoke("save_settings", { json });
    } catch (err) {
      console.error("保存设置失败:", err);
    }
  };

  const updateWindow = (partial: Partial<WindowSettings>) =>
    save({ ...settings, window: { ...settings.window, ...partial } });

  const updateAnimation = (partial: Partial<AnimationSettings>) =>
    save({ ...settings, animation: { ...settings.animation, ...partial } });

  const updateAudio = (partial: Partial<AudioSettings>) =>
    save({ ...settings, audio: { ...settings.audio, ...partial } });

  const updateSpeech = (partial: Partial<SpeechSettings>) =>
    save({ ...settings, speech: { ...settings.speech, ...partial } });

  const updateAgent = (partial: Partial<AgentSettings>) =>
    save({ ...settings, agent: { ...settings.agent, ...partial } });

  const updatePomodoro = (partial: Partial<PomodoroSettings>) =>
    save({ ...settings, pomodoro: { ...settings.pomodoro, ...partial } });

  const updateObservation = (partial: Partial<ObservationSettings>) =>
    save({ ...settings, observation: { ...settings.observation, ...partial } });

  const updateMemory = (partial: Partial<MemorySettings>) =>
    save({ ...settings, memory: { ...settings.memory, ...partial } });

  const runTimerCommand = async (
    command: () => Promise<TimerSnapshot>,
    clearAfter = false,
  ) => {
    setTimerError(null);
    try {
      const snapshot = await command();
      setTimer(clearAfter ? null : snapshot);
    } catch (error) {
      setTimerError(error instanceof Error ? error.message : String(error));
    }
  };

  const startTimer = (kind: TimerKind) => {
    const minutes = kind === "focus"
      ? settings.pomodoro.focusMinutes
      : settings.pomodoro.breakMinutes;
    const timerId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `timer-${Date.now()}`;
    void runTimerCommand(() => timerController.start({
      timerId,
      durationMs: minutes * 60_000,
      kind,
      label: kind === "focus" ? "专注时间" : "休息时间",
      showSystemReminder: settings.pomodoro.showSystemReminder,
      soundEnabled: settings.pomodoro.soundEnabled && settings.audio.enabled,
    }));
  };

  const remainingMs = timer?.status === "running" && timer.deadlineUnixMs !== null
    ? Math.max(0, timer.deadlineUnixMs - now)
    : timer?.remainingMs ?? 0;

  const saveApiKey = async () => {
    const key = apiKeyDraft.trim();
    if (!key) {
      setApiKeyStatus("请输入 API key");
      return;
    }
    try {
      await setApiKey("openai-compatible", key);
      setApiKeyDraft("");
      setApiKeyPresent(true);
      setApiKeyStatus("API key 已写入 Windows DPAPI 加密存储");
    } catch (error) {
      setApiKeyStatus(`保存 API key 失败：${String(error)}`);
    }
  };

  const removeApiKey = async () => {
    try {
      await deleteApiKey("openai-compatible");
      setApiKeyDraft("");
      setApiKeyPresent(false);
      setApiKeyStatus("API key 已删除");
    } catch (error) {
      setApiKeyStatus(`删除 API key 失败：${String(error)}`);
    }
  };

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: 18 }}>绨络设置</h1>
        {loadError && <div style={warnStyle}>设置文件损坏，已使用默认值</div>}
      </header>

      <main style={mainStyle}>
        <Section title="窗口">
          <Row label="始终置顶">
            <input
              type="checkbox"
              checked={settings.window.alwaysOnTop}
              onChange={(e) => updateWindow({ alwaysOnTop: e.target.checked })}
            />
          </Row>
          <Row label="轮廓外点击穿透">
            <input
              type="checkbox"
              checked={settings.window.clickThrough}
              onChange={(e) => updateWindow({ clickThrough: e.target.checked })}
            />
          </Row>
        </Section>

        <Section title="动画">
          <Row label="动作强度">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.animation.intensity}
              onChange={(e) =>
                updateAnimation({ intensity: Number(e.target.value) })
              }
              style={{ width: 160 }}
            />
            <span style={valueStyle}>
              {Math.round(settings.animation.intensity * 100)}%
            </span>
          </Row>
        </Section>

        <Section title="声音">
          <Row label="启用声音">
            <input
              type="checkbox"
              checked={settings.audio.enabled}
              onChange={(e) => updateAudio({ enabled: e.target.checked })}
            />
          </Row>
          <Row label="音量">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.audio.volume}
              onChange={(e) => updateAudio({ volume: Number(e.target.value) })}
              disabled={!settings.audio.enabled}
              style={{ width: 160 }}
            />
            <span style={valueStyle}>
              {Math.round(settings.audio.volume * 100)}%
            </span>
          </Row>
        </Section>

        <Section title="本机语音与口型">
          <Row label="启用语音朗读">
            <input
              type="checkbox"
              checked={settings.speech.enabled}
              onChange={(event) => updateSpeech({ enabled: event.target.checked })}
              disabled={!settings.audio.enabled}
            />
          </Row>
          <Row label="自动朗读模型回复">
            <input
              type="checkbox"
              checked={settings.speech.autoReadReplies}
              onChange={(event) => updateSpeech({ autoReadReplies: event.target.checked })}
              disabled={!settings.audio.enabled || !settings.speech.enabled}
            />
          </Row>
          <Row label="系统音色">
            <select
              value={settings.speech.voiceUri}
              onChange={(event) => updateSpeech({ voiceUri: event.target.value })}
              disabled={!settings.audio.enabled || !settings.speech.enabled}
              style={wideInputStyle}
            >
              <option value="">系统默认本地音色</option>
              {speechVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}（{voice.language}）
                </option>
              ))}
            </select>
          </Row>
          <Row label="语速">
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={settings.speech.rate}
              onChange={(event) => updateSpeech({ rate: Number(event.target.value) })}
              disabled={!settings.audio.enabled || !settings.speech.enabled}
              style={{ width: 160 }}
            />
            <span style={valueStyle}>{settings.speech.rate.toFixed(2)}×</span>
          </Row>
          <Row label="音高">
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={settings.speech.pitch}
              onChange={(event) => updateSpeech({ pitch: Number(event.target.value) })}
              disabled={!settings.audio.enabled || !settings.speech.enabled}
              style={{ width: 160 }}
            />
            <span style={valueStyle}>{settings.speech.pitch.toFixed(2)}×</span>
          </Row>
          <div style={timerActionsStyle}>
            <button
              type="button"
              style={btnStyle}
              disabled={!settings.audio.enabled || !settings.speech.enabled}
              onClick={() => void emitTo("main", "speech-read-request", {
                id: `settings-preview-${Date.now()}`,
                text: "你好呀，我是小洛宝。现在的声音和口型感觉怎么样？",
              })}
            >
              试听
            </button>
            <button
              type="button"
              style={btnStyle}
              onClick={() => void emitTo("main", "speech-stop-request")}
            >
              停止朗读
            </button>
          </div>
          <p style={hintStyle}>
            使用 Windows WebView 提供的本地系统音色；应用不保存语音音频，也不配置或调用外部 TTS 接口。
          </p>
        </Section>

        <Section title="番茄钟">
          <Row label="专注时长（分钟）">
            <input
              type="number"
              min="1"
              max="180"
              value={settings.pomodoro.focusMinutes}
              onChange={(event) => updatePomodoro({
                focusMinutes: Math.min(180, Math.max(1, Math.round(Number(event.target.value) || 1))),
              })}
              style={numberInputStyle}
            />
          </Row>
          <Row label="休息时长（分钟）">
            <input
              type="number"
              min="1"
              max="180"
              value={settings.pomodoro.breakMinutes}
              onChange={(event) => updatePomodoro({
                breakMinutes: Math.min(180, Math.max(1, Math.round(Number(event.target.value) || 1))),
              })}
              style={numberInputStyle}
            />
          </Row>
          <Row label="完成时系统提醒">
            <input
              type="checkbox"
              checked={settings.pomodoro.showSystemReminder}
              onChange={(event) => updatePomodoro({ showSystemReminder: event.target.checked })}
            />
          </Row>
          <Row label="完成时提示音">
            <input
              type="checkbox"
              checked={settings.pomodoro.soundEnabled}
              onChange={(event) => updatePomodoro({ soundEnabled: event.target.checked })}
            />
          </Row>
          <div style={timerStatusStyle} aria-live="polite">
            {timer
              ? `${timer.label || "计时"} · ${timer.status === "running" ? "进行中" : "已暂停"} · ${formatDuration(remainingMs)}`
              : "当前没有计时"}
          </div>
          <div style={timerActionsStyle}>
            <button style={btnStyle} disabled={timer !== null} onClick={() => startTimer("focus")}>开始专注</button>
            <button style={btnStyle} disabled={timer !== null} onClick={() => startTimer("break")}>开始休息</button>
            {timer?.status === "running" && (
              <button style={btnStyle} onClick={() => void runTimerCommand(() => timerController.pause(timer.timerId))}>暂停</button>
            )}
            {timer?.status === "paused" && (
              <button style={btnStyle} onClick={() => void runTimerCommand(() => timerController.resume(timer.timerId))}>继续</button>
            )}
            {timer && (
              <button style={dangerBtnStyle} onClick={() => void runTimerCommand(() => timerController.cancel(timer.timerId), true)}>取消</button>
            )}
          </div>
          {timerError && <div style={warnStyle}>{timerError}</div>}
          <p style={hintStyle}>关闭设置窗口或重启桌宠不会丢失正在进行或暂停的计时。</p>
        </Section>

        <Section title="对话与 Agent">
          <Row label="对话 Provider">
            <select
              value={settings.agent.provider}
              onChange={(event) => updateAgent({
                provider: event.target.value === "openai-compatible"
                  ? "openai-compatible"
                  : "mock",
              })}
              style={textInputStyle}
            >
              <option value="mock">离线 Mock</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </Row>
          {settings.agent.provider === "openai-compatible" && (
            <>
              <Row label="接口地址">
                <input
                  type="url"
                  value={settings.agent.endpoint}
                  onChange={(event) => updateAgent({ endpoint: event.target.value })}
                  style={wideInputStyle}
                  spellCheck={false}
                />
              </Row>
              <Row label="模型名称">
                <input
                  type="text"
                  value={settings.agent.model}
                  onChange={(event) => updateAgent({ model: event.target.value })}
                  placeholder="由供应商提供"
                  maxLength={128}
                  style={textInputStyle}
                  spellCheck={false}
                />
              </Row>
              <Row label={`API key（${apiKeyPresent ? "已保存" : "未保存"}）`}>
                <input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  placeholder={apiKeyPresent ? "输入新 key 可覆盖" : "不会写入设置文件"}
                  autoComplete="off"
                  style={textInputStyle}
                />
              </Row>
              <p style={hintStyle}>本地模型无需鉴权时可以留空；保存后才会发送 Bearer key。</p>
              <div style={timerActionsStyle}>
                <button type="button" style={btnStyle} onClick={() => void saveApiKey()}>保存 API key</button>
                <button type="button" style={dangerBtnStyle} disabled={!apiKeyPresent} onClick={() => void removeApiKey()}>删除 API key</button>
              </div>
              <Row label="上下文预算（字符）">
                <input
                  type="number"
                  min="1000"
                  max="100000"
                  step="1000"
                  value={settings.agent.maxContextChars}
                  onChange={(event) => updateAgent({
                    maxContextChars: Math.min(100_000, Math.max(1_000, Math.round(Number(event.target.value) || 1_000))),
                  })}
                  style={numberInputStyle}
                />
              </Row>
              <Row label="请求超时（秒）">
                <input
                  type="number"
                  min="3"
                  max="120"
                  value={Math.round(settings.agent.timeoutMs / 1_000)}
                  onChange={(event) => updateAgent({
                    timeoutMs: Math.min(120, Math.max(3, Math.round(Number(event.target.value) || 3))) * 1_000,
                  })}
                  style={numberInputStyle}
                />
              </Row>
              <Row label="首包前重试次数">
                <input
                  type="number"
                  min="0"
                  max="2"
                  value={settings.agent.maxRetries}
                  onChange={(event) => updateAgent({
                    maxRetries: Math.min(2, Math.max(0, Math.round(Number(event.target.value) || 0))),
                  })}
                  style={numberInputStyle}
                />
              </Row>
              <Row label="允许外发对话文本">
                <input
                  type="checkbox"
                  checked={settings.agent.externalDataConsent}
                  onChange={(event) => updateAgent({ externalDataConsent: event.target.checked })}
                />
              </Row>
              <Row label="允许 HTTP 明文接口">
                <input
                  type="checkbox"
                  checked={settings.agent.allowInsecureHttp}
                  onChange={(event) => updateAgent({ allowInsecureHttp: event.target.checked })}
                />
              </Row>
              {settings.agent.allowInsecureHttp && (
                <div style={dangerNoticeStyle} role="alert">
                  临时测试模式：API key、对话上下文和回复会通过 HTTP 明文传输。仅在你信任的 Radmin VPN 或局域网中使用，测试结束后请关闭。
                </div>
              )}
              <p style={hintStyle}>
                仅发送输入及预算范围内的最近对话，不发送屏幕、窗口、应用状态或其他系统感知数据。
              </p>
              {apiKeyStatus && <div style={timerStatusStyle}>{apiKeyStatus}</div>}
            </>
          )}
          <div style={timerActionsStyle}>
            <button type="button" style={btnStyle} onClick={() => void invoke("open_chat")}>打开对话窗口</button>
          </div>
          <p style={hintStyle}>离线 Mock 不联网；对话记录只保留在当前窗口内存中。</p>
          <div style={{ height: 8 }} />
          <Row label="启用 Agent">
            <input
              type="checkbox"
              checked={settings.agent.enabled}
              onChange={(e) => updateAgent({ enabled: e.target.checked })}
            />
          </Row>
          <p style={hintStyle}>
            开启后，模型只能调用版本化白名单语义工具；窗口移动与取消计时仍需逐次确认。不会获得 shell、文件、进程、任意网络或 DOM 权限。
          </p>
        </Section>

        <Section title="外部状态反馈">
          <Row label="允许外部状态触发角色反应">
            <input
              type="checkbox"
              checked={settings.observation.enabled}
              onChange={(event) => updateObservation({ enabled: event.target.checked })}
            />
          </Row>
          <Row label="对系统音乐作出反应">
            <input
              type="checkbox"
              checked={settings.observation.systemMediaEnabled}
              disabled={!settings.observation.enabled}
              onChange={(event) => updateObservation({ systemMediaEnabled: event.target.checked })}
            />
          </Row>
          <Row label="音乐反应强度">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.observation.musicReactionIntensity}
              disabled={!settings.observation.enabled || !settings.observation.systemMediaEnabled}
              onChange={(event) => updateObservation({ musicReactionIntensity: Number(event.target.value) })}
              style={{ width: 160 }}
            />
            <span style={valueStyle}>{Math.round(settings.observation.musicReactionIntensity * 100)}%</span>
          </Row>
          <Row label="保留脱敏事件诊断">
            <input
              type="checkbox"
              checked={settings.observation.diagnosticsEnabled}
              onChange={(event) => updateObservation({ diagnosticsEnabled: event.target.checked })}
            />
          </Row>
          <Row label="启用安静时段">
            <input
              type="checkbox"
              checked={settings.observation.quietHoursEnabled}
              onChange={(event) => updateObservation({ quietHoursEnabled: event.target.checked })}
            />
          </Row>
          {settings.observation.quietHoursEnabled && (
            <>
              <Row label="安静时段开始">
                <input
                  type="time"
                  value={formatMinuteOfDay(settings.observation.quietHoursStartMinute)}
                  onChange={(event) => updateObservation({ quietHoursStartMinute: parseTimeValue(event.target.value) })}
                />
              </Row>
              <Row label="安静时段结束">
                <input
                  type="time"
                  value={formatMinuteOfDay(settings.observation.quietHoursEndMinute)}
                  onChange={(event) => updateObservation({ quietHoursEndMinute: parseTimeValue(event.target.value) })}
                />
              </Row>
            </>
          )}
          <p style={hintStyle}>
            默认关闭。系统音乐只读取 playing、paused、stopped，不读取标题、歌手、歌词或音频内容。事件只在本地经过校验、频率限制和调度器；诊断不保存 payload、代码、prompt 或终端输出。相同的安静时段起止时间表示全天安静。“立即停止所有自主行为”也会暂停外部反馈，需关闭再开启总开关后恢复。
          </p>
        </Section>

        <Section title="创作者插件">
          <PluginSettingsPanel observationEnabled={settings.observation.enabled} />
        </Section>

        <Section title="长期记忆与羁绊">
          <MemorySettingsPanel settings={settings.memory} onChange={updateMemory} />
        </Section>

        <Section title="行为控制">
          <button
            style={dangerBtnStyle}
            onClick={() => {
              void invoke("stop_all_behaviors");
            }}
          >
            立即停止所有自主行为
          </button>
        </Section>
      </main>

      <footer style={footerStyle}>
        <button
          style={btnStyle}
          onClick={() => getCurrentWindow().close()}
        >
          关闭
        </button>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={rowStyle}>
      <span style={{ flex: 1 }}>{label}</span>
      {children}
    </label>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMinuteOfDay(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseTimeValue(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return 0;
  return Math.min(1_439, Math.max(0, hours * 60 + minutes));
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
  fontSize: 14,
  color: "#222",
  background: "#fafafa",
};

const headerStyle: CSSProperties = {
  padding: "16px 20px 12px",
  borderBottom: "1px solid #e5e5e5",
  background: "#fff",
};

const mainStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 20px",
};

const sectionStyle: CSSProperties = {
  padding: "12px 0",
  borderBottom: "1px solid #eee",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  color: "#888",
  margin: "0 0 8px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "6px 0",
  cursor: "pointer",
};

const valueStyle: CSSProperties = {
  minWidth: 40,
  textAlign: "right",
  color: "#666",
  fontVariantNumeric: "tabular-nums",
};

const numberInputStyle: CSSProperties = {
  width: 72,
  padding: "4px 6px",
};

const textInputStyle: CSSProperties = {
  width: 210,
  padding: "5px 7px",
};

const wideInputStyle: CSSProperties = {
  ...textInputStyle,
  width: 280,
};

const timerStatusStyle: CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 4,
  background: "#eef8f7",
  color: "#176b66",
  fontVariantNumeric: "tabular-nums",
};

const timerActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 8,
};

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: "#888",
  margin: "4px 0 0",
};

const footerStyle: CSSProperties = {
  padding: "12px 20px",
  borderTop: "1px solid #e5e5e5",
  background: "#fff",
  display: "flex",
  justifyContent: "flex-end",
};

const btnStyle: CSSProperties = {
  padding: "6px 16px",
  background: "#f0f0f0",
  border: "1px solid #ccc",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
};

const dangerBtnStyle: CSSProperties = {
  ...btnStyle,
  background: "#fef2f2",
  borderColor: "#fca5a5",
  color: "#b91c1c",
};

const dangerNoticeStyle: CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 4,
  background: "#fff1f2",
  border: "1px solid #fda4af",
  color: "#9f1239",
  fontSize: 12,
  lineHeight: 1.5,
};

const warnStyle: CSSProperties = {
  marginTop: 8,
  padding: "4px 8px",
  background: "#fef3c7",
  border: "1px solid #fcd34d",
  borderRadius: 4,
  fontSize: 12,
  color: "#92400e",
};
