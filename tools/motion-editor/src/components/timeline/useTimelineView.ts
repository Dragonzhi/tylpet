import { useEffect, useRef, useState } from "react";
import type { MotionClipV1 } from "@ltypet/character-motion";
import type { TimelineProperty, TimelineRange } from "../../timeline/model";
import {
  getFilteredTimelineRows,
  normalizeTimelineRange,
  pixelsPerFrameForRange,
} from "../../timeline/model";
import { clampKeyframeDelta, frameToTimelineX } from "../../timeline/geometry";
import type { KeyframeRef } from "../../editor/model/types";

export type NumericProperty = Exclude<TimelineProperty, "renderSlot">;

export interface TimelineViewState {
  partFilter: string;
  setPartFilter: (value: string) => void;
  propertyFilter: TimelineProperty | "";
  setPropertyFilter: (value: TimelineProperty | "") => void;
  keyedOnly: boolean;
  setKeyedOnly: (value: boolean) => void;
  rangeStart: string;
  setRangeStart: (value: string) => void;
  rangeEnd: string;
  setRangeEnd: (value: string) => void;
  visibleRange: TimelineRange | null;
  moveDelta: string;
  setMoveDelta: (value: string) => void;
  adjustProperty: NumericProperty;
  setAdjustProperty: (value: NumericProperty) => void;
  adjustDelta: string;
  setAdjustDelta: (value: string) => void;
  width: number;
  availablePartIds: string[];
  rows: ReturnType<typeof getFilteredTimelineRows>;
  zoomToRange: (scrollRef: React.RefObject<HTMLDivElement | null>) => void;
  moveSelectedByInput: () => void;
  adjustSelectedByInput: () => void;
}

export function useTimelineView(
  clip: MotionClipV1,
  selectedPartId: string | null,
  pixelsPerFrame: number,
  selectedKeyframes: KeyframeRef[],
  onPixelsPerFrameChange: (value: number) => void,
  onMoveKeyframes: (refs: KeyframeRef[], deltaFrames: number) => void,
  onAdjustKeyframes: ((refs: KeyframeRef[], property: NumericProperty, delta: number) => void) | undefined,
): TimelineViewState {
  const [partFilter, setPartFilter] = useState<string>("");
  const [propertyFilter, setPropertyFilter] = useState<TimelineProperty | "">("");
  const [keyedOnly, setKeyedOnly] = useState(false);
  const [rangeStart, setRangeStart] = useState("0");
  const [rangeEnd, setRangeEnd] = useState(String(clip.durationFrames));
  const [visibleRange, setVisibleRange] = useState<TimelineRange | null>(null);
  const [moveDelta, setMoveDelta] = useState("1");
  const [adjustProperty, setAdjustProperty] = useState<NumericProperty>("rotation");
  const [adjustDelta, setAdjustDelta] = useState("1");
  const zoomFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setRangeStart("0");
    setRangeEnd(String(clip.durationFrames));
    setVisibleRange(null);
  }, [clip.id, clip.durationFrames]);

  useEffect(() => () => {
    if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
  }, []);

  const width = Math.max(clip.durationFrames * pixelsPerFrame + 40, 640);
  const availablePartIds = [...new Set([
    ...(selectedPartId ? [selectedPartId] : []),
    ...clip.tracks.map((track) => track.partId),
  ])];
  const rows = getFilteredTimelineRows(clip, selectedPartId, {
    partId: partFilter || null,
    property: propertyFilter || null,
    keyedOnly,
  });

  const zoomToRange = (scrollRef: React.RefObject<HTMLDivElement | null>): void => {
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

  const moveSelectedByInput = (): void => {
    const requested = Number(moveDelta);
    if (!Number.isInteger(requested) || requested === 0 || selectedKeyframes.length === 0) return;
    const delta = clampKeyframeDelta(selectedKeyframes.map((ref) => ref.frame), requested, clip.durationFrames);
    if (delta !== 0) onMoveKeyframes(selectedKeyframes, delta);
  };

  const adjustSelectedByInput = (): void => {
    const delta = Number(adjustDelta);
    if (!onAdjustKeyframes || !Number.isFinite(delta) || delta === 0 || selectedKeyframes.length === 0) return;
    onAdjustKeyframes(selectedKeyframes, adjustProperty, delta);
  };

  return {
    partFilter,
    setPartFilter,
    propertyFilter,
    setPropertyFilter,
    keyedOnly,
    setKeyedOnly,
    rangeStart,
    setRangeStart,
    rangeEnd,
    setRangeEnd,
    visibleRange,
    moveDelta,
    setMoveDelta,
    adjustProperty,
    setAdjustProperty,
    adjustDelta,
    setAdjustDelta,
    width,
    availablePartIds,
    rows,
    zoomToRange,
    moveSelectedByInput,
    adjustSelectedByInput,
  };
}
