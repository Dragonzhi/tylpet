import { useRef } from "react";
import type { MotionClipV1 } from "@ltypet/character-motion";
import type { KeyframeRef } from "../../editor/model/types";
import type { TimelineProperty, TimelineRange } from "../../timeline/model";
import { getFilteredTimelineRows } from "../../timeline/model";
import { keyframeRefKey } from "../../lib/keyframeRef";
import { frameToTimelineX, timelineXToFrame } from "../../timeline/geometry";

interface TimelineTracksProps {
  clip: MotionClipV1;
  rows: ReturnType<typeof getFilteredTimelineRows>;
  width: number;
  visibleRange: TimelineRange | null;
  pixelsPerFrame: number;
  currentFrame: number;
  selectedKeyframes: KeyframeRef[];
  selectedPartId: string | null;
  propertyFilter: TimelineProperty | "";
  onFrameChange: (frame: number) => void;
  onSelectKeyframe: (ref: KeyframeRef, modifiers: { toggle: boolean; range: boolean }) => void;
  markerDelta: (ref: KeyframeRef) => number;
  beginMarkerDrag: (
    event: React.PointerEvent<HTMLButtonElement>,
    ref: KeyframeRef,
    selectedSet: Set<string>,
  ) => void;
  updateMarkerDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  finishMarkerDrag: () => void;
  cancelMarkerDrag: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function TimelineTracks({
  clip,
  rows,
  width,
  visibleRange,
  pixelsPerFrame,
  currentFrame,
  selectedKeyframes,
  selectedPartId,
  propertyFilter,
  onFrameChange,
  onSelectKeyframe,
  markerDelta,
  beginMarkerDrag,
  updateMarkerDrag,
  finishMarkerDrag,
  cancelMarkerDrag,
  scrollRef,
}: TimelineTracksProps) {
  const labelsRef = useRef<HTMLDivElement>(null);
  const selectedSet = new Set(selectedKeyframes.map((ref) => keyframeRefKey(ref)));
  // 标尺刻度节奏与背景主线共用，保证数字刻度、主线、关键帧三者严格对齐
  const tickEvery = Math.max(1, Math.round(40 / pixelsPerFrame));

  const setFrameFromPointer = (clientX: number): void => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    onFrameChange(timelineXToFrame(clientX - rect.left + scroll.scrollLeft, pixelsPerFrame, clip.durationFrames));
  };

  return (
    <div className="timeline-grid">
      <div
        className="timeline-labels"
        ref={labelsRef}
        onScroll={(event) => {
          const scroll = scrollRef.current;
          if (scroll && scroll.scrollTop !== event.currentTarget.scrollTop) {
            scroll.scrollTop = event.currentTarget.scrollTop;
          }
        }}
      >
        <div className="timeline-ruler-label">帧</div>
        {rows.flatMap(({ partId, properties }) => [
          ...(propertyFilter ? [] : [<div key={`${partId}-main`} className={`track-label part ${partId === selectedPartId ? "selected" : ""}`}>{partId}</div>]),
          ...properties.map((property) => (
            <div key={`${partId}-${property.id}`} className="track-label property">{property.label}</div>
          )),
        ])}
      </div>
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const labels = labelsRef.current;
          if (labels && labels.scrollTop !== event.currentTarget.scrollTop) {
            labels.scrollTop = event.currentTarget.scrollTop;
          }
        }}
      >
        <div
          className="timeline-content"
          style={{
            width,
            // 背景网格周期跟随缩放，使网格线始终与帧/关键帧位置同步
            "--ppf": `${pixelsPerFrame}px`,
            "--ppf-major": `${tickEvery * pixelsPerFrame}px`,
          } as React.CSSProperties}
        >
          {visibleRange && (
            <div
              className="timeline-range"
              style={{
                left: frameToTimelineX(visibleRange.startFrame, pixelsPerFrame),
                width: frameToTimelineX(visibleRange.endFrame - visibleRange.startFrame, pixelsPerFrame),
              }}
            />
          )}
          <button
            type="button"
            className="frame-ruler"
            aria-label="设置播放头"
            onPointerDown={(event) => setFrameFromPointer(event.clientX)}
            onPointerMove={(event) => {
              if (event.buttons === 1) setFrameFromPointer(event.clientX);
            }}
          >
            {Array.from({ length: clip.durationFrames + 1 }, (_, frame) => frame)
              .filter((frame) => frame % tickEvery === 0)
              .map((frame) => (
                <span key={frame} className="ruler-tick" style={{ left: frameToTimelineX(frame, pixelsPerFrame) }}>
                  {frame}
                </span>
              ))}
          </button>
          {rows.flatMap(({ partId, properties }) => {
            const track = clip.tracks.find((candidate) => candidate.partId === partId);
            const main = (
              <div key={`${partId}-main`} className="track-row part-track">
                {track?.keyframes.map((keyframe) => {
                  const ref = { clipId: clip.id, partId, frame: keyframe.frame };
                  const selected = selectedSet.has(keyframeRefKey(ref));
                  return (
                    <button
                      type="button"
                      key={keyframe.frame}
                      className={`keyframe-marker ${selected ? "selected" : ""}`}
                      style={{ left: frameToTimelineX(keyframe.frame + markerDelta(ref), pixelsPerFrame) }}
                      aria-label={`${partId} 第 ${keyframe.frame} 帧关键帧`}
                      onClick={(event) => {
                        if (event.detail === 0) {
                          onSelectKeyframe(ref, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
                        }
                      }}
                      onPointerDown={(event) => beginMarkerDrag(event, ref, selectedSet)}
                      onPointerMove={updateMarkerDrag}
                      onPointerUp={finishMarkerDrag}
                      onPointerCancel={cancelMarkerDrag}
                    />
                  );
                })}
              </div>
            );
            const propertyRows = properties.map((property) => (
              <div key={`${partId}-${property.id}`} className="track-row property-track">
                {track?.keyframes.filter((keyframe) => keyframe.values[property.id] !== undefined).map((keyframe) => (
                  <span
                    key={keyframe.frame}
                    className={`property-key ${property.id === "renderSlot" ? "discrete" : ""}`}
                    style={{ left: frameToTimelineX(keyframe.frame, pixelsPerFrame) }}
                  />
                ))}
              </div>
            ));
            return [...(propertyFilter ? [] : [main]), ...propertyRows];
          })}
          <div className="playhead" style={{ left: frameToTimelineX(currentFrame, pixelsPerFrame) }}>
            <span>{currentFrame}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
