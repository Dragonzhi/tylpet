import { useRef } from "react";
import type {
  CharacterRigV1,
  MotionClipV1,
  MotionEventType,
} from "@ltypet/character-motion";
import type { KeyframeRef } from "../../editor/model/types";
import { useTimelineView } from "./useTimelineView";
import type { NumericProperty } from "./useTimelineView";
import { useMarkerDrag } from "./useMarkerDrag";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineTools } from "./TimelineTools";
import { TimelineTracks } from "./TimelineTracks";
import { ClipDiagnostics } from "./ClipDiagnostics";

export type { NumericProperty };

export interface TimelineProps {
  clip: MotionClipV1;
  rig?: CharacterRigV1;
  supportedEvents?: readonly MotionEventType[];
  selectedPartId: string | null;
  currentFrame: number;
  pixelsPerFrame: number;
  selectedKeyframes: KeyframeRef[];
  onFrameChange(frame: number): void;
  onPixelsPerFrameChange(value: number): void;
  onSelectKeyframe(ref: KeyframeRef, modifiers: { toggle: boolean; range: boolean }): void;
  onMoveKeyframes(refs: KeyframeRef[], deltaFrames: number): void;
  onAdjustKeyframes?(refs: KeyframeRef[], property: NumericProperty, delta: number): void;
}

export function Timeline({
  clip,
  rig,
  supportedEvents,
  selectedPartId,
  currentFrame,
  pixelsPerFrame,
  selectedKeyframes,
  onFrameChange,
  onPixelsPerFrameChange,
  onSelectKeyframe,
  onMoveKeyframes,
  onAdjustKeyframes,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const view = useTimelineView(
    clip,
    selectedPartId,
    pixelsPerFrame,
    selectedKeyframes,
    onPixelsPerFrameChange,
    onMoveKeyframes,
    onAdjustKeyframes,
  );
  const drag = useMarkerDrag(
    selectedKeyframes,
    onSelectKeyframe,
    onMoveKeyframes,
    pixelsPerFrame,
    clip.durationFrames,
  );

  return (
    <section className="timeline-panel" aria-label="动作时间轴">
      <TimelineToolbar
        clipId={clip.id}
        fps={clip.fps}
        durationFrames={clip.durationFrames}
        pixelsPerFrame={pixelsPerFrame}
        onPixelsPerFrameChange={onPixelsPerFrameChange}
      />
      <TimelineTools
        partFilter={view.partFilter}
        onPartFilterChange={view.setPartFilter}
        availablePartIds={view.availablePartIds}
        propertyFilter={view.propertyFilter}
        onPropertyFilterChange={view.setPropertyFilter}
        keyedOnly={view.keyedOnly}
        onKeyedOnlyChange={view.setKeyedOnly}
        rangeStart={view.rangeStart}
        onRangeStartChange={view.setRangeStart}
        rangeEnd={view.rangeEnd}
        onRangeEndChange={view.setRangeEnd}
        durationFrames={clip.durationFrames}
        onZoomToRange={() => view.zoomToRange(scrollRef)}
        moveDelta={view.moveDelta}
        onMoveDeltaChange={view.setMoveDelta}
        hasSelection={selectedKeyframes.length > 0}
        onMoveSelected={view.moveSelectedByInput}
        adjustProperty={view.adjustProperty}
        onAdjustPropertyChange={view.setAdjustProperty}
        adjustDelta={view.adjustDelta}
        onAdjustDeltaChange={view.setAdjustDelta}
        hasAdjustHandler={!!onAdjustKeyframes}
        onAdjustSelected={view.adjustSelectedByInput}
      />
      <TimelineTracks
        clip={clip}
        rows={view.rows}
        width={view.width}
        visibleRange={view.visibleRange}
        pixelsPerFrame={pixelsPerFrame}
        currentFrame={currentFrame}
        selectedKeyframes={selectedKeyframes}
        selectedPartId={selectedPartId}
        propertyFilter={view.propertyFilter}
        onFrameChange={onFrameChange}
        onSelectKeyframe={onSelectKeyframe}
        markerDelta={drag.markerDelta}
        beginMarkerDrag={drag.beginMarkerDrag}
        updateMarkerDrag={drag.updateMarkerDrag}
        finishMarkerDrag={drag.finishMarkerDrag}
        cancelMarkerDrag={drag.cancelMarkerDrag}
        scrollRef={scrollRef}
      />
      {rig && <ClipDiagnostics clip={clip} rig={rig} supportedEvents={supportedEvents} />}
    </section>
  );
}
