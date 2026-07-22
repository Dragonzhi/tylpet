import type { TransformValue, MotionClipV1, MotionKeyframeV1 } from "@ltypet/character-motion";
import type { SvgCanvasAdapter, PartScreenGeometry } from "../../svgcanvas/SvgCanvasAdapter";
import { TransformGizmo } from "./TransformGizmo";

export interface StageAreaProps {
  stageRef: React.RefObject<HTMLElement | null>;
  panHandlers: {
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMoveCapture: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUpCapture: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancelCapture: () => void;
  };
  containerRef: React.RefObject<HTMLDivElement | null>;
  tool: "select" | "pivot";
  onSetTool: (tool: "select" | "pivot") => void;
  activeClip: MotionClipV1 | null;
  selectedPartId: string | null;
  exactKeyframe: MotionKeyframeV1 | null;
  displayedTransform: TransformValue | null;
  displayedPivot: { x: number; y: number } | null;
  lockedPartIds: Set<string>;
  geometry: PartScreenGeometry | null;
  adapterRef: React.RefObject<SvgCanvasAdapter | null>;
  stagePan: { x: number; y: number };
  onInsertCurrentKeyframe: () => void;
  onDeleteCurrentKeyframe: () => void;
  onCommitTransform: (value: TransformValue) => void;
  onCommitPivot: (x: number, y: number) => void;
  onSetTransformDraft: (draft: { partId: string; value: TransformValue } | null) => void;
  onSetPivotDraft: (draft: { partId: string; x: number; y: number } | null) => void;
  onAddLog: (message: string) => void;
}

export function StageArea({
  stageRef,
  panHandlers,
  containerRef,
  tool,
  onSetTool,
  activeClip,
  selectedPartId,
  exactKeyframe,
  displayedTransform,
  displayedPivot,
  lockedPartIds,
  geometry,
  adapterRef,
  stagePan,
  onInsertCurrentKeyframe,
  onDeleteCurrentKeyframe,
  onCommitTransform,
  onCommitPivot,
  onSetTransformDraft,
  onSetPivotDraft,
  onAddLog,
}: StageAreaProps) {
  return (
    <main
      className="stage-area"
      ref={stageRef}
      {...panHandlers}
    >
      <div className="stage-tools">
        <button type="button" className={tool === "select" ? "selected" : ""} onClick={() => onSetTool("select")}>选择/变换</button>
        <button type="button" className={tool === "pivot" ? "selected" : ""} onClick={() => onSetTool("pivot")}>Pivot 工具</button>
        <button type="button" onClick={onInsertCurrentKeyframe} disabled={!activeClip || !selectedPartId}>F6 打帧</button>
        <button type="button" onClick={onDeleteCurrentKeyframe} disabled={!exactKeyframe}>Shift+F6 删除</button>
      </div>
      <div
        ref={containerRef}
        className="canvas-container"
        style={{ transform: `translate(${stagePan.x}px, ${stagePan.y}px)` }}
      />
      <TransformGizmo
        geometry={geometry}
        partId={selectedPartId}
        transform={displayedTransform}
        pivot={displayedPivot}
        hasKeyframe={!!exactKeyframe}
        locked={selectedPartId ? lockedPartIds.has(selectedPartId) : false}
        tool={tool}
        stageElement={stageRef.current}
        screenDeltaToSvg={(dx, dy) => adapterRef.current?.screenDeltaToSvg(dx, dy) ?? null}
        screenDeltaToPartLocal={(pid, dx, dy) => adapterRef.current?.screenDeltaToPartLocal(pid, dx, dy) ?? null}
        onTransformPreview={(value) => selectedPartId && onSetTransformDraft({ partId: selectedPartId, value })}
        onTransformCommit={onCommitTransform}
        onPivotPreview={(x, y) => selectedPartId && onSetPivotDraft({ partId: selectedPartId, x, y })}
        onPivotCommit={onCommitPivot}
        onCancel={() => { onSetTransformDraft(null); onSetPivotDraft(null); }}
        onNeedsKeyframe={() => onAddLog("[提示] 当前帧尚无关键帧，请先按 F6")}
      />
    </main>
  );
}
