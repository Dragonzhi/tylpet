import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  PetSettings,
  WindowSettings,
  AnimationSettings,
  AudioSettings,
  AgentSettings,
} from "../domain/settings/types";
import { parseSettings } from "../domain/settings/validate";
import { createDefaultSettings } from "../domain/settings/defaults";

export default function SettingsWindow() {
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const updateAgent = (partial: Partial<AgentSettings>) =>
    save({ ...settings, agent: { ...settings.agent, ...partial } });

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: 18 }}>小洛宝设置</h1>
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

        <Section title="Agent">
          <Row label="启用 Agent">
            <input
              type="checkbox"
              checked={settings.agent.enabled}
              onChange={(e) => updateAgent({ enabled: e.target.checked })}
            />
          </Row>
          <p style={hintStyle}>
            关闭后所有 Agent 触发的行为将被丢弃，但手动触发的行为仍可执行。
          </p>
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

const warnStyle: CSSProperties = {
  marginTop: 8,
  padding: "4px 8px",
  background: "#fef3c7",
  border: "1px solid #fcd34d",
  borderRadius: 4,
  fontSize: 12,
  color: "#92400e",
};
