import type { MotionClipV1, CharacterRigV1 } from "@ltypet/character-motion";
import type { KeyframeRef, KeyframeClipboard, EditorCommand } from "../../editor/model/types";
import { Timeline } from "../timeline/Timeline";

export interface BottomEditorProps {
  activeClip: MotionClipV1 | null;
  currentFrame: number;
  isPlaying: boolean;
  selectedKeyframes: KeyframeRef[];
  clipboard: KeyframeClipboard | null;
  pixelsPerFrame: number;
  rig: CharacterRigV1 | null;
  selectedPartId: string | null;
  onSetCurrentFrame: (frame: number | ((prev: number) => number)) => void;
  onTogglePlay: () => void;
  onCopySelected: () => void;
  onPasteSelected: () => void;
  onDeleteSelected: () => void;
  onPixelsPerFrameChange: (value: number) => void;
  onFrameChange: (frame: number) => void;
  onSelectKeyframe: (ref: KeyframeRef, modifiers: { toggle: boolean; range: boolean }) => void;
  onMoveKeyframes: (refs: KeyframeRef[], deltaFrames: number) => void;
  onRunCommand: (command: EditorCommand) => boolean;
}

export function BottomEditor({
  activeClip,
  currentFrame,
  isPlaying,
  selectedKeyframes,
  clipboard,
  pixelsPerFrame,
  rig,
  selectedPartId,
  onSetCurrentFrame,
  onTogglePlay,
  onCopySelected,
  onPasteSelected,
  onDeleteSelected,
  onPixelsPerFrameChange,
  onFrameChange,
  onSelectKeyframe,
  onMoveKeyframes,
  onRunCommand,
}: BottomEditorProps) {
  return (
    <footer className="bottom-editor">
      {activeClip ? (
        <>
          <div className="playback-bar">
            <button type="button" onClick={() => onSetCurrentFrame(0)} aria-label="首帧">⏮</button>
            <button type="button" onClick={() => onSetCurrentFrame((frame) => Math.max(0, frame - 1))} aria-label="前一帧">◀</button>
            <button type="button" onClick={onTogglePlay}>{isPlaying ? "⏸ 暂停" : "▶ 播放"}</button>
            <button type="button" onClick={() => onSetCurrentFrame((frame) => Math.min(activeClip.durationFrames, frame + 1))} aria-label="后一帧">▶</button>
            <button type="button" onClick={() => onSetCurrentFrame(activeClip.durationFrames)} aria-label="末帧">⏭</button>
            <span>{currentFrame}/{activeClip.durationFrames}</span>
            <button type="button" onClick={onCopySelected} disabled={!selectedKeyframes.length}>复制帧</button>
            <button type="button" onClick={onPasteSelected} disabled={!clipboard}>粘贴帧</button>
            <button type="button" onClick={onDeleteSelected} disabled={!selectedKeyframes.length}>删除帧</button>
          </div>
          <Timeline
            clip={activeClip}
            rig={rig ?? undefined}
            selectedPartId={selectedPartId}
            currentFrame={currentFrame}
            pixelsPerFrame={pixelsPerFrame}
            selectedKeyframes={selectedKeyframes}
            onFrameChange={onFrameChange}
            onPixelsPerFrameChange={onPixelsPerFrameChange}
            onSelectKeyframe={onSelectKeyframe}
            onMoveKeyframes={onMoveKeyframes}
            onAdjustKeyframes={(refs, property, delta) => {
              onRunCommand({ type: "keyframe.adjustMany", refs, property, delta });
            }}
          />
        </>
      ) : <div className="empty-timeline">新建或导入 Motion Clip 后开始制作动作</div>}
    </footer>
  );
}
