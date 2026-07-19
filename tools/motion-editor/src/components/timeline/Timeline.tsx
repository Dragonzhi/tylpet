import { useRef, useState } from "react";
import type { MotionClipV1, MotionKeyframeV1 } from "@ltypet/character-motion";
import type { KeyframeRef } from "../../editor/model/types";
import { clampKeyframeDelta, frameToTimelineX, timelineXToFrame } from "../../timeline/geometry";

interface Props {
  clip: MotionClipV1;
  selectedPartId: string | null;
  currentFrame: number;
  pixelsPerFrame: number;
  selectedKeyframes: KeyframeRef[];
  onFrameChange(frame: number): void;
  onPixelsPerFrameChange(value: number): void;
  onSelectKeyframe(ref: KeyframeRef, modifiers: { toggle: boolean; range: boolean }): void;
  onMoveKeyframes(refs: KeyframeRef[], deltaFrames: number): void;
}

const PROPERTY_ROWS: Array<{ id: keyof MotionKeyframeV1["values"]; label: string }> = [
  { id: "x", label: "X" },
  { id: "y", label: "Y" },
  { id: "rotation", label: "旋转" },
  { id: "scaleX", label: "缩放 X" },
  { id: "scaleY", label: "缩放 Y" },
  { id: "opacity", label: "透明度" },
  { id: "renderSlot", label: "层级" },
];

export function Timeline({
  clip,
  selectedPartId,
  currentFrame,
  pixelsPerFrame,
  selectedKeyframes,
  onFrameChange,
  onPixelsPerFrameChange,
  onSelectKeyframe,
  onMoveKeyframes,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ refs: KeyframeRef[]; startX: number; delta: number } | null>(null);
  const width = Math.max(clip.durationFrames * pixelsPerFrame + 40, 640);
  const selectedSet = new Set(selectedKeyframes.map((ref) => `${ref.clipId}\0${ref.partId}\0${ref.frame}`));
  const trackIds = [...new Set([
    ...(selectedPartId ? [selectedPartId] : []),
    ...clip.tracks.map((track) => track.partId),
  ])];

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
        <label>
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
          {trackIds.flatMap((partId) => [
            <div key={`${partId}-main`} className={`track-label part ${partId === selectedPartId ? "selected" : ""}`}>{partId}</div>,
            ...PROPERTY_ROWS.map((property) => (
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
            {trackIds.flatMap((partId) => {
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
              const properties = PROPERTY_ROWS.map((property) => (
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
              return [main, ...properties];
            })}
            <div className="playhead" style={{ left: frameToTimelineX(currentFrame, pixelsPerFrame) }}>
              <span>{currentFrame}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
