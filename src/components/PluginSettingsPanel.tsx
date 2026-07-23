import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  parseInstalledPlugins,
  type InstalledPlugin,
  type ManifestInspection,
} from "../domain/plugins/types";

export default function PluginSettingsPanel({ observationEnabled }: { observationEnabled: boolean }) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [manifestPath, setManifestPath] = useState("");
  const [inspection, setInspection] = useState<ManifestInspection | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void invoke<unknown>("plugin_list")
      .then((value) => {
        if (active) setPlugins(parseInstalledPlugins(value));
      })
      .catch((error: unknown) => {
        if (active) setStatus(`读取插件列表失败：${String(error)}`);
      });
    void listen<unknown>("plugins-changed", (event) => {
      if (active) setPlugins(parseInstalledPlugins(event.payload));
    }).then((cleanup) => {
      if (active) unlisten = cleanup;
      else cleanup();
    }).catch((error: unknown) => {
      if (active) setStatus(`监听插件状态失败：${String(error)}`);
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const inspect = async () => {
    const path = manifestPath.trim();
    if (!path) {
      setStatus("请输入 ltypet.plugin.json 的完整路径");
      return;
    }
    setBusy(true);
    setInspection(null);
    setStatus(null);
    try {
      const value = await invoke<ManifestInspection>("plugin_inspect_manifest", { path });
      setInspection(value);
      setStatus("manifest 校验通过，请核对权限后确认安装");
    } catch (error) {
      setStatus(`manifest 检查失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!inspection) return;
    setBusy(true);
    setStatus(null);
    try {
      const installed = await invoke<InstalledPlugin>("plugin_install_inspected", {
        inspectionToken: inspection.inspectionToken,
      });
      setPlugins((current) => [
        ...current.filter((plugin) => plugin.id !== installed.id),
        installed,
      ].sort((left, right) => left.id.localeCompare(right.id)));
      setInspection(null);
      setStatus("插件已安装；凭据路径已生成，可供受信任的本机 hook 使用");
    } catch (error) {
      setStatus(`安装失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (plugin: InstalledPlugin, enabled: boolean) => {
    setBusy(true);
    setStatus(null);
    try {
      const value = await invoke<unknown>("plugin_set_enabled", {
        pluginId: plugin.id,
        enabled,
      });
      setPlugins(parseInstalledPlugins(value));
      setStatus(enabled ? `${plugin.name} 已启用` : `${plugin.name} 已禁用，旧凭据立即失效`);
    } catch (error) {
      setStatus(`切换插件失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async (plugin: InstalledPlugin) => {
    if (!window.confirm(`卸载“${plugin.name}”？其本地凭据也会被删除。`)) return;
    setBusy(true);
    setStatus(null);
    try {
      const value = await invoke<unknown>("plugin_uninstall", { pluginId: plugin.id });
      setPlugins(parseInstalledPlugins(value));
      setStatus(`${plugin.name} 已卸载`);
    } catch (error) {
      setStatus(`卸载插件失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!observationEnabled && (
        <p style={noticeStyle}>外部状态反馈总开关当前关闭；插件可以安装，但事件不会触发角色行为。</p>
      )}
      <label style={fieldStyle}>
        <span>本地 manifest 路径</span>
        <input
          type="text"
          value={manifestPath}
          onChange={(event) => {
            setManifestPath(event.target.value);
            setInspection(null);
          }}
          placeholder="D:\\...\\ltypet.plugin.json"
          spellCheck={false}
          style={pathInputStyle}
        />
      </label>
      <button type="button" style={buttonStyle} disabled={busy} onClick={() => void inspect()}>
        检查 manifest
      </button>

      {inspection && (
        <div style={inspectionStyle}>
          <strong>{inspection.manifest.name}</strong>
          <div>{inspection.manifest.id} · v{inspection.manifest.version}</div>
          <div>宿主范围：{inspection.manifest.hostCompatibility}</div>
          <div>事件权限：{inspection.manifest.permissions.observationEvents.join("、")}</div>
          <div>最高敏感级别：{inspection.manifest.permissions.maxSensitivity}</div>
          <ul style={{ margin: "6px 0", paddingLeft: 20 }}>
            {inspection.permissionChanges.map((change) => <li key={change}>{change}</li>)}
          </ul>
          <p style={hintStyle}>
            此确认只安装声明与本机凭据，不执行安装脚本，也不会把第三方代码加载进桌宠。
          </p>
          <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void install()}>
            {inspection.replacesExisting ? "确认升级" : "确认安装"}
          </button>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {plugins.length === 0 && <p style={hintStyle}>尚未安装创作者插件。</p>}
        {plugins.map((plugin) => (
          <article key={plugin.id} style={pluginStyle}>
            <div style={pluginHeaderStyle}>
              <div>
                <strong>{plugin.name}</strong>
                <div style={hintStyle}>{plugin.id} · v{plugin.version}</div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>启用</span>
                <input
                  type="checkbox"
                  checked={plugin.enabled}
                  disabled={busy}
                  onChange={(event) => void setEnabled(plugin, event.target.checked)}
                />
              </label>
            </div>
            <div style={hintStyle}>允许事件：{plugin.observationEvents.join("、")}；敏感级别 ≤ {plugin.maxSensitivity}</div>
            <div style={credentialStyle}>凭据：{plugin.credentialPath}</div>
            <button type="button" style={dangerButtonStyle} disabled={busy} onClick={() => void uninstall(plugin)}>
              卸载
            </button>
          </article>
        ))}
      </div>
      {status && <div style={statusStyle} role="status">{status}</div>}
      <p style={hintStyle}>
        首版桥接仅监听随机本机回环端口，并要求每个插件的随机凭据；同一 Windows 用户下运行的恶意程序仍属于同一信任边界，请只侧载你信任的 hook。
      </p>
    </div>
  );
}

const fieldStyle: CSSProperties = { display: "grid", gap: 5, marginBottom: 8 };
const pathInputStyle: CSSProperties = { padding: "6px 8px", width: "100%", boxSizing: "border-box" };
const buttonStyle: CSSProperties = { padding: "6px 12px", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" };
const primaryButtonStyle: CSSProperties = { ...buttonStyle, background: "#e6fffb", borderColor: "#5eead4" };
const dangerButtonStyle: CSSProperties = { ...buttonStyle, marginTop: 8, color: "#b91c1c", background: "#fff1f2", borderColor: "#fda4af" };
const inspectionStyle: CSSProperties = { marginTop: 10, padding: 10, borderRadius: 6, background: "#f0fdfa", border: "1px solid #99f6e4", lineHeight: 1.55 };
const pluginStyle: CSSProperties = { padding: "10px 0", borderTop: "1px solid #eee" };
const pluginHeaderStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12 };
const credentialStyle: CSSProperties = { marginTop: 5, fontSize: 11, color: "#666", overflowWrap: "anywhere" };
const hintStyle: CSSProperties = { fontSize: 12, color: "#777", margin: "5px 0", lineHeight: 1.5 };
const noticeStyle: CSSProperties = { ...hintStyle, color: "#92400e", background: "#fef3c7", padding: 8, borderRadius: 4 };
const statusStyle: CSSProperties = { marginTop: 8, padding: 8, borderRadius: 4, background: "#eef8f7", color: "#176b66" };
