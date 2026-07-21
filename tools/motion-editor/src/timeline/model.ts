import type { MotionClipV1, MotionKeyframeV1 } from "@ltypet/character-motion";

export type TimelineProperty = keyof MotionKeyframeV1["values"];

export interface TimelineFilter {
  partId: string | null;
  property: TimelineProperty | null;
  keyedOnly: boolean;
}

export interface TimelineRange {
  startFrame: number;
  endFrame: number;
}

export const TIMELINE_PROPERTIES: ReadonlyArray<{
  id: TimelineProperty;
  label: string;
}> = [
  { id: "x", label: "X" },
  { id: "y", label: "Y" },
  { id: "rotation", label: "旋转" },
  { id: "scaleX", label: "缩放 X" },
  { id: "scaleY", label: "缩放 Y" },
  { id: "opacity", label: "透明度" },
  { id: "renderSlot", label: "层级" },
];

export function getFilteredTimelineRows(
  clip: MotionClipV1,
  selectedPartId: string | null,
  filter: TimelineFilter,
): Array<{
  partId: string;
  properties: typeof TIMELINE_PROPERTIES;
}> {
  const partIds = [...new Set([
    ...(selectedPartId ? [selectedPartId] : []),
    ...clip.tracks.map((track) => track.partId),
  ])];

  return partIds.flatMap((partId) => {
    if (filter.partId !== null && partId !== filter.partId) return [];
    const track = clip.tracks.find((candidate) => candidate.partId === partId);
    if (filter.keyedOnly && (!track || track.keyframes.length === 0)) return [];
    const properties = TIMELINE_PROPERTIES.filter(({ id }) => {
      if (filter.property !== null && id !== filter.property) return false;
      return !filter.keyedOnly || track?.keyframes.some((keyframe) => keyframe.values[id] !== undefined);
    });
    return [{ partId, properties }];
  });
}

export function normalizeTimelineRange(
  startFrame: number,
  endFrame: number,
  durationFrames: number,
): TimelineRange | null {
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) return null;
  const start = Math.max(0, Math.min(durationFrames, Math.round(startFrame)));
  const end = Math.max(0, Math.min(durationFrames, Math.round(endFrame)));
  if (start === end) return null;
  return {
    startFrame: Math.min(start, end),
    endFrame: Math.max(start, end),
  };
}

export function pixelsPerFrameForRange(
  range: TimelineRange,
  viewportWidth: number,
  minPixelsPerFrame = 4,
  maxPixelsPerFrame = 24,
): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return minPixelsPerFrame;
  const availableWidth = Math.max(1, viewportWidth - 24);
  const requested = availableWidth / Math.max(1, range.endFrame - range.startFrame);
  return Math.max(minPixelsPerFrame, Math.min(maxPixelsPerFrame, requested));
}
