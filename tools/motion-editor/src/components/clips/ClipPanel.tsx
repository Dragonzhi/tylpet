import type { MotionClipV1, ProceduralChannel, MotionLibraryV1 } from "@ltypet/character-motion";
import { cloneClip } from "../../editor/model/documentCommands";
import type { EditorCommand, KeyframeRef } from "../../editor/model/types";

const PROCEDURAL_CHANNELS: ProceduralChannel[] = [
  "breathing", "blinking", "pointer-follow", "hair-physics", "ear-twitch",
];

export interface ClipPanelProps {
  history: { present: unknown; past: unknown[]; future: unknown[] } | null;
  activeClip: MotionClipV1 | null;
  motionLibrary: MotionLibraryV1 | null;
  activeClipId: string | null;
  onSetActiveClipId: (id: string | null) => void;
  onSetCurrentFrame: (frame: number | ((prev: number) => number)) => void;
  onSetSelectedKeyframes: (keyframes: KeyframeRef[] | ((prev: KeyframeRef[]) => KeyframeRef[])) => void;
  onRunCommand: (command: EditorCommand) => boolean;
  onStopAnimation: () => void;
}

export function ClipPanel({
  history,
  activeClip,
  motionLibrary,
  activeClipId,
  onSetActiveClipId,
  onSetCurrentFrame,
  onSetSelectedKeyframes,
  onRunCommand,
  onStopAnimation,
}: ClipPanelProps) {
  const addClip = () => {
    if (!history) return;
    const id = window.prompt("新动作 ID（小写字母、数字、_、-）", "idle")?.trim();
    if (!id) return;
    const clip: MotionClipV1 = { id, fps: 24, durationFrames: 48, loop: "none", tracks: [], events: [] };
    if (onRunCommand({ type: "clip.add", clip })) {
      onSetActiveClipId(id);
      onSetCurrentFrame(0);
    }
  };

  const duplicateClip = () => {
    if (!activeClip) return;
    const id = window.prompt("复制后的动作 ID", `${activeClip.id}_copy`)?.trim();
    if (!id) return;
    if (onRunCommand({ type: "clip.add", clip: { ...cloneClip(activeClip), id } })) onSetActiveClipId(id);
  };

  const renameClip = () => {
    if (!activeClip) return;
    const id = window.prompt("新的动作 ID", activeClip.id)?.trim();
    if (!id || id === activeClip.id) return;
    if (onRunCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { id } })) onSetActiveClipId(id);
  };

  const deleteClip = () => {
    if (!activeClip || !window.confirm(`删除动作 ${activeClip.id}？`)) return;
    const next = motionLibrary?.clips.find((clip) => clip.id !== activeClip.id)?.id ?? null;
    if (onRunCommand({ type: "clip.delete", clipId: activeClip.id })) {
      onSetActiveClipId(next);
      onSetCurrentFrame(0);
    }
  };

  return (
    <section className="panel clip-panel">
      <h2>Motion Clips</h2>
      <div className="clip-actions">
        <button type="button" onClick={addClip} disabled={!history}>＋新建</button>
        <button type="button" onClick={duplicateClip} disabled={!activeClip}>复制</button>
        <button type="button" onClick={renameClip} disabled={!activeClip}>改名</button>
        <button type="button" onClick={deleteClip} disabled={!activeClip}>删除</button>
      </div>
      <ul className="clip-list">
        {motionLibrary?.clips.map((clip) => (
          <li key={clip.id}>
            <button
              type="button"
              className={clip.id === activeClipId ? "selected" : ""}
              onClick={() => {
                onStopAnimation();
                onSetActiveClipId(clip.id);
                onSetCurrentFrame(0);
                onSetSelectedKeyframes([]);
              }}
            >
              {clip.id}<span>{clip.durationFrames}f</span>
            </button>
          </li>
        ))}
      </ul>
      {activeClip && (
        <div className="clip-meta">
          <label>FPS <input type="number" min="1" max="60" value={activeClip.fps} onChange={(event) => onRunCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { fps: Number(event.target.value) } })} /></label>
          <label>末帧 <input type="number" min="1" value={activeClip.durationFrames} onChange={(event) => onRunCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { durationFrames: Number(event.target.value) } })} /></label>
          <label>循环 <select value={activeClip.loop} onChange={(event) => onRunCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { loop: event.target.value as MotionClipV1["loop"] } })}><option value="none">none</option><option value="repeat">repeat</option></select></label>
        </div>
      )}
      {activeClip && (
        <fieldset className="procedural-channels">
          <legend>暂停程序动画</legend>
          {PROCEDURAL_CHANNELS.map((channel) => (
            <label key={channel}>
              <input
                type="checkbox"
                checked={activeClip.suppressProceduralChannels?.includes(channel) ?? false}
                onChange={(event) => {
                  const current = activeClip.suppressProceduralChannels ?? [];
                  const next = event.target.checked
                    ? [...current, channel]
                    : current.filter((candidate) => candidate !== channel);
                  onRunCommand({
                    type: "clip.updateMeta",
                    clipId: activeClip.id,
                    patch: { suppressProceduralChannels: next },
                  });
                }}
              />
              {channel}
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
