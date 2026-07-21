import { useEffect, useRef, useState } from "react";
import type {
  CharacterRigV1,
  MotionClipV1,
  MotionEventType,
} from "@ltypet/character-motion";
import type { KeyframeRef } from "../../editor/model/types";
import { clampKeyframeDelta, frameToTimelineX, timelineXToFrame } from "../../timeline/geometry";
import {
  getFilteredTimelineRows,
  normalizeTimelineRange,
  pixelsPerFrameForRange,
  TIMELINE_PROPERTIES,
} from "../../timeline/model";
import type { TimelineProperty, TimelineRange } from "../../timeline/model";
import { ClipDiagnostics } from "./ClipDiagnostics";

type NumericProperty = Exclude<TimelineProperty, "renderSlot">;

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

const NUMERIC_PROPERTIES = TIMELINE_PROPERTIES.filter(
  (property): property is { id: NumericProperty; label: string } => property.id !== "renderSlot",
);

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
  const labelsRef = useRef<HTMLDivElement>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<{ refs: KeyframeRef[]; startX: number; delta: number } | null>(null);
  const [partFilter, setPartFilter] = useState<string>("");
  const [propertyFilter, setPropertyFilter] = useState<TimelineProperty | "">("");
  const [keyedOnly, setKeyedOnly] = useState(false);
  const [rangeStart, setRangeStart] = useState("0");
  const [rangeEnd, setRangeEnd] = useState(String(clip.durationFrames));
  const [visibleRange, setVisibleRange] = useState<TimelineRange | null>(null);
  const [moveDelta, setMoveDelta] = useState("1");
  const [adjustProperty, setAdjustProperty] = useState<NumericProperty>("rotation");
  const [adjustDelta, setAdjustDelta] = useState("1");
  useEffect(() => {
    setRangeStart("0");
    setRangeEnd(String(clip.durationFrames));
    setVisibleRange(null);
  }, [clip.id, clip.durationFrames]);
  useEffect(() => () => {
    if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
  }, []);
  const width = Math.max(clip.durationFrames * pixelsPerFrame + 40, 640);
  const selectedSet = new Set(selectedKeyframes.map((ref) => `${ref.clipId}\0${ref.partId}\0${ref.frame}`));
  const availablePartIds = [...new Set([
    ...(selectedPartId ? [selectedPartId] : []),
    ...clip.tracks.map((track) => track.partId),
  ])];
  const rows = getFilteredTimelineRows(clip, selectedPartId, {
    partId: partFilter || null,
    property: propertyFilter || null,
    keyedOnly,
  });

  const zoomToRange = () => {
    const range = normalizeTimelineRange(Number(rangeStart), Number(rangeEnd), clip.durationFrames);
    if (!range) return;
    const scroll = scrollRef.current;
    const nextPixelsPerFrame = pixelsPerFrameForRange(range, scroll?.clientWidth ?? 0);
    setRangeStart(String(range.startFrame));
    setRangeEnd(String(range.endFrame));
    setVisibleRange(range);
    onPixelsPerFrameChange(nextPixelsPerFrame);
    if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
    zoomFrameRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = frameToTimelineX(range.startFrame, nextPixelsPerFrame);
      zoomFrameRef.current = null;
    });
  };

  const moveSelectedByInput = () => {
    const requested = Number(moveDelta);
    if (!Number.isInteger(requested) || requested === 0 || selectedKeyframes.length === 0) return;
    const delta = clampKeyframeDelta(selectedKeyframes.map((ref) => ref.frame), requested, clip.durationFrames);
    if (delta !== 0) onMoveKeyframes(selectedKeyframes, delta);
  };

  const adjustSelectedByInput = () => {
    const delta = Number(adjustDelta);
    if (!onAdjustKeyframes || !Number.isFinite(delta) || delta === 0 || selectedKeyframes.length === 0) return;
    onAdjustKeyframes(selectedKeyframes, adjustProperty, delta);
  };

  const setFrameFromPointer = (clientX: number) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = scroll.getBoundingClientRect();
    onFrameChange(timelineXToFrame(clientX - rect.left + scroll.scrollLeft, pixelsPerFrame, clip.durationFrames));
  };

  const beginMarkerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    ref: KeyframeRef,
  ) => {
    event.stopPropagation();
    const key = `${ref.clipId}\0${ref.partId}\0${ref.frame}`;
    const refs = selectedSet.has(key) ? selectedKeyframes : [ref];
    if (!selectedSet.has(key)) onSelectKeyframe(ref, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ refs, startX: event.clientX, delta: 0 });
  };

  const updateMarkerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const requested = Math.round((event.clientX - drag.startX) / pixelsPerFrame);
    const delta = clampKeyframeDelta(drag.refs.map((ref) => ref.frame), requested, clip.durationFrames);
    setDrag({ ...drag, delta });
  };

  const finishMarkerDrag = () => {
    if (!drag) return;
    if (drag.delta !== 0) onMoveKeyframes(drag.refs, drag.delta);
    setDrag(null);
  };

  const markerDelta = (ref: KeyframeRef) => drag?.refs.some((candidate) =>
    candidate.clipId === ref.clipId && candidate.partId === ref.partId && candidate.frame === ref.frame)
    ? drag.delta : 0;

  return (
    <section className="timeline-panel" aria-label="动作时间轴">
      <div className="timeline-toolbar">
        <strong>{clip.id}</strong>
        <span>{clip.fps} fps · 0—{clip.durationFrames}</span>
        <label className="timeline-zoom-control">
          缩放
          <input
            type="range"
            min="4"
            max="24"
            value={pixelsPerFrame}
            onChange={(event) => onPixelsPerFrameChange(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="timeline-tools" aria-label="时间轴效率工具">
        <label>
          Part
          <select value={partFilter} onChange={(event) => setPartFilter(event.target.value)}>
            <option value="">全部</option>
            {availablePartIds.map((partId) => <option key={partId} value={partId}>{partId}</option>)}
          </select>
        </label>
        <label>
          属性
          <select value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value as TimelineProperty | "")}>
            <option value="">全部</option>
            {TIMELINE_PROPERTIES.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}
          </select>
        </label>
        <label className="timeline-check">
          <input type="checkbox" checked={keyedOnly} onChange={(event) => setKeyedOnly(event.target.checked)} />
          仅有关键帧
        </label>
        <span className="timeline-tool-separator" />
        <label>区间 <input aria-label="区间起始帧" type="number" min="0" max={clip.durationFrames} value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label>
        <span>—</span>
        <input aria-label="区间结束帧" type="number" min="0" max={clip.durationFrames} value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
        <button type="button" onClick={zoomToRange}>缩放到区间</button>
        <span className="timeline-tool-separator" />
        <label>位移 <input aria-label="批量帧位移" type="number" step="1" value={moveDelta} onChange={(event) => setMoveDelta(event.target.value)} /></label>
        <button type="button" disabled={selectedKeyframes.length === 0} onClick={moveSelectedByInput}>移动所选</button>
        <label>
          微调
          <select value={adjustProperty} onChange={(event) => setAdjustProperty(event.target.value as NumericProperty)}>
            {NUMERIC_PROPERTIES.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}
          </select>
        </label>
        <input aria-label="多选关键帧微调量" type="number" step="any" value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} />
        <button type="button" disabled={!onAdjustKeyframes || selectedKeyframes.length === 0} onClick={adjustSelectedByInput}>应用微调</button>
      </div>
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
          <div className="timeline-content" style={{ width }}>
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
                .filter((frame) => frame % Math.max(1, Math.round(40 / pixelsPerFrame)) === 0)
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
                    const selected = selectedSet.has(`${clip.id}\0${partId}\0${keyframe.frame}`);
                    return (
                      <button
                        type="button"
                        key={keyframe.frame}
                        className={`keyframe-marker ${selected ? "selected" : ""}`}
                        style={{ left: frameToTimelineX(keyframe.frame + markerDelta(ref), pixelsPerFrame) }}
                        aria-label={`${partId} 第 ${keyframe.frame} 帧关键帧`}
                        onClick={(event) => {
                          // Pointer selection already happens on pointerdown so a
                          // drag ending over a neighbouring marker cannot select it.
                          // detail=0 keeps Enter/Space keyboard activation usable.
                          if (event.detail === 0) {
                            onSelectKeyframe(ref, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
                          }
                        }}
                        onPointerDown={(event) => beginMarkerDrag(event, ref)}
                        onPointerMove={updateMarkerDrag}
                        onPointerUp={finishMarkerDrag}
                        onPointerCancel={() => setDrag(null)}
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
      {rig && <ClipDiagnostics clip={clip} rig={rig} supportedEvents={supportedEvents} />}
    </section>
  );
}
