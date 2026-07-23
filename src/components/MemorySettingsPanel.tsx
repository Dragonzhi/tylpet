import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { MemoryController } from "../controllers/MemoryController";
import { bondLevelFor, type MemoryCategory, type MemorySnapshot } from "../domain/memory/types";
import type { MemorySettings } from "../domain/settings/types";

const controller = new MemoryController();

export default function MemorySettingsPanel({
  settings,
  onChange,
}: {
  settings: MemorySettings;
  onChange(partial: Partial<MemorySettings>): void;
}) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("preference");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bondLevel = useMemo(() => snapshot ? bondLevelFor(snapshot.bond.points) : null, [snapshot]);

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    void controller.getSnapshot().then((response) => {
      if (!active) return;
      setSnapshot(response.snapshot);
      if (response.recovery === "backup") setStatus("主记忆文件损坏，已从备份恢复");
      if (response.recovery === "reset") setStatus("记忆文件与备份均损坏，已安全重置为空数据");
    }).catch((error: unknown) => active && setStatus(`读取失败：${String(error)}`));
    void listen<MemorySnapshot>("memory-changed", (event) => {
      if (active) setSnapshot(event.payload);
    }).then((unlisten) => {
      if (active) cleanup = unlisten;
      else unlisten();
    }).catch(() => undefined);
    return () => { active = false; cleanup?.(); };
  }, []);

  const run = async (operation: () => Promise<MemorySnapshot>, success: string): Promise<boolean> => {
    setBusy(true);
    setStatus(null);
    try {
      setSnapshot(await operation());
      setStatus(success);
      return true;
    } catch (error) {
      setStatus(`操作失败：${formatError(error)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const value = content.trim();
    if (!value) { setStatus("记忆内容不能为空"); return; }
    void run(() => controller.addEntry(value, category), "已保存；来源标记为“用户明确保存”")
      .then((saved) => { if (saved) setContent(""); });
  };

  return (
    <div>
      <label style={rowStyle}>
        <span style={growStyle}>启用长期体验</span>
        <input type="checkbox" checked={settings.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      </label>
      <label style={rowStyle}>
        <span style={growStyle}>向模型提供已保存记忆</span>
        <input
          type="checkbox"
          checked={settings.includeInModelContext}
          disabled={!settings.enabled}
          onChange={(event) => onChange({ includeInModelContext: event.target.checked })}
        />
      </label>
      <label style={rowStyle}>
        <span style={growStyle}>记录确定性羁绊</span>
        <input
          type="checkbox"
          checked={settings.bondEnabled}
          disabled={!settings.enabled}
          onChange={(event) => onChange({ bondEnabled: event.target.checked })}
        />
      </label>
      <label style={stackedRowStyle}>
        <span>对话式记忆提议</span>
        <select
          value={settings.proposalMode}
          disabled={!settings.enabled}
          onChange={(event) => onChange({ proposalMode: event.target.value as MemorySettings["proposalMode"] })}
        >
          <option value="off">关闭</option>
          <option value="confirm">每次保存前确认</option>
          <option value="explicit-auto">明确说“记住”时自动保存</option>
        </select>
      </label>
      <p style={hintStyle}>
        总开关关闭即为无记忆模式：已有数据保留但不读取、不注入模型，也不增加羁绊。模型不能直接新增、编辑或删除记忆，只能在启用后提出候选。
        使用外部模型且开启“向模型提供”时，这些明确保存的记忆摘要会随本轮请求发送到你配置的模型接口。
        对话式提议只允许模型生成候选；“每次确认”模式始终询问，“明确说记住”模式也只对包含明确记忆指令的当前消息自动接受，其余自主提议仍会询问。
      </p>

      <div style={bondStyle}>
        <strong>羁绊：{bondLevel?.name ?? "加载中"}</strong>
        <span>{snapshot?.bond.points ?? 0}/100</span>
        <small>成功完成一次对话 +1；每天最多 3 次；重复请求不计分；永不扣分。</small>
      </div>
      {(snapshot?.bond.events.length ?? 0) > 0 && (
        <details style={auditStyle}>
          <summary>查看最近羁绊变化原因</summary>
          {[...(snapshot?.bond.events ?? [])].reverse().slice(0, 10).map((event) => (
            <div key={event.id}>+{event.delta} · {event.reason} · {new Date(event.occurredAtMs).toLocaleString()}</div>
          ))}
        </details>
      )}

      <div style={editorStyle}>
        <select value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} disabled={busy}>
          <option value="preference">偏好</option>
          <option value="profile">个人资料</option>
          <option value="note">备注</option>
        </select>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={300}
          rows={2}
          placeholder="只保存你希望小洛宝长期知道的事实（最多 300 字）"
          style={textareaStyle}
          disabled={busy}
        />
        <button type="button" onClick={add} disabled={busy || !content.trim()}>明确保存</button>
      </div>

      <div style={listStyle}>
        {(snapshot?.entries ?? []).map((entry) => (
          <MemoryEntryEditor
            key={entry.id}
            entry={entry}
            busy={busy}
            onSave={(nextContent, nextCategory) => void run(
              () => controller.updateEntry(entry.id, nextContent, nextCategory),
              "记忆已更新",
            )}
            onDelete={() => {
              if (window.confirm("确定删除这条长期记忆吗？删除后下一轮对话不再使用。")) {
                void run(() => controller.deleteEntry(entry.id), "记忆已删除");
              }
            }}
          />
        ))}
        {snapshot?.entries.length === 0 && <span style={hintStyle}>尚未保存任何长期记忆。</span>}
      </div>

      <div style={actionsStyle}>
        <button type="button" disabled={busy} onClick={() => void controller.exportToDownloads()
          .then((path) => setStatus(`已导出到：${path}`))
          .catch((error: unknown) => setStatus(`导出失败：${formatError(error)}`))}>导出 JSON</button>
        <button type="button" disabled={busy} style={dangerStyle} onClick={() => {
          if (window.confirm("确定清除全部长期记忆和羁绊吗？此操作不能撤销。")) {
            void run(() => controller.clearAll(), "全部长期数据已清除");
          }
        }}>一键清除</button>
      </div>
      {status && <div style={statusStyle} role="status">{status}</div>}
      <p style={hintStyle}>长期数据与聊天会话、普通设置分开保存；导出内容不包含 API key 或完整聊天记录。</p>
    </div>
  );
}

function MemoryEntryEditor({
  entry,
  busy,
  onSave,
  onDelete,
}: {
  entry: MemorySnapshot["entries"][number];
  busy: boolean;
  onSave(content: string, category: MemoryCategory): void;
  onDelete(): void;
}) {
  const [content, setContent] = useState(entry.content);
  const [category, setCategory] = useState(entry.category);
  useEffect(() => { setContent(entry.content); setCategory(entry.category); }, [entry]);
  return (
    <div style={entryStyle}>
      <select value={category} onChange={(event) => setCategory(event.target.value as MemoryCategory)} disabled={busy}>
        <option value="preference">偏好</option><option value="profile">个人资料</option><option value="note">备注</option>
      </select>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={300} rows={2} style={textareaStyle} disabled={busy} />
      <small>来源：{entry.reason}</small>
      <div style={actionsStyle}>
        <button type="button" disabled={busy || !content.trim()} onClick={() => onSave(content.trim(), category)}>保存修改</button>
        <button type="button" disabled={busy} style={dangerStyle} onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "7px 0" };
const stackedRowStyle: CSSProperties = { display: "grid", gap: 6, padding: "7px 0" };
const growStyle: CSSProperties = { flex: 1 };
const hintStyle: CSSProperties = { color: "#666", fontSize: 12, lineHeight: 1.6 };
const bondStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr auto", gap: 6, padding: 12, background: "#eef8f6", borderRadius: 8, margin: "10px 0" };
const auditStyle: CSSProperties = { fontSize: 12, lineHeight: 1.7, marginBottom: 10 };
const editorStyle: CSSProperties = { display: "grid", gap: 8, padding: "10px 0" };
const textareaStyle: CSSProperties = { width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" };
const listStyle: CSSProperties = { display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" };
const entryStyle: CSSProperties = { display: "grid", gap: 6, padding: 10, border: "1px solid #ddd", borderRadius: 8, background: "#fff" };
const actionsStyle: CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
const dangerStyle: CSSProperties = { color: "#a22", borderColor: "#d99" };
const statusStyle: CSSProperties = { marginTop: 8, padding: 8, background: "#f3f3f3", borderRadius: 6, wordBreak: "break-all" };

function formatError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try { return JSON.stringify(error); } catch { return "未知错误"; }
}
