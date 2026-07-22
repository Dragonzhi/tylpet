import { useState } from "react";
import type { KeyframeRef } from "../../editor/model/types";
import { keyframeRefKey } from "../../lib/keyframeRef";
import { clampKeyframeDelta } from "../../timeline/geometry";

interface MarkerDrag {
  refs: KeyframeRef[];
  startX: number;
  delta: number;
}

export interface MarkerDragHandlers {
  markerDelta: (ref: KeyframeRef) => number;
  beginMarkerDrag: (
    event: React.PointerEvent<HTMLButtonElement>,
    ref: KeyframeRef,
    selectedSet: Set<string>,
  ) => void;
  updateMarkerDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  finishMarkerDrag: () => void;
  cancelMarkerDrag: () => void;
}

export function useMarkerDrag(
  selectedKeyframes: KeyframeRef[],
  onSelectKeyframe: (ref: KeyframeRef, modifiers: { toggle: boolean; range: boolean }) => void,
  onMoveKeyframes: (refs: KeyframeRef[], deltaFrames: number) => void,
  pixelsPerFrame: number,
  durationFrames: number,
): MarkerDragHandlers {
  const [drag, setDrag] = useState<MarkerDrag | null>(null);

  const beginMarkerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    ref: KeyframeRef,
    selectedSet: Set<string>,
  ): void => {
    event.stopPropagation();
    const key = keyframeRefKey(ref);
    const refs = selectedSet.has(key) ? selectedKeyframes : [ref];
    if (!selectedSet.has(key)) onSelectKeyframe(ref, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ refs, startX: event.clientX, delta: 0 });
  };

  const updateMarkerDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!drag) return;
    const requested = Math.round((event.clientX - drag.startX) / pixelsPerFrame);
    const delta = clampKeyframeDelta(drag.refs.map((ref) => ref.frame), requested, durationFrames);
    setDrag({ ...drag, delta });
  };

  const finishMarkerDrag = (): void => {
    if (!drag) return;
    if (drag.delta !== 0) onMoveKeyframes(drag.refs, drag.delta);
    setDrag(null);
  };

  const cancelMarkerDrag = (): void => {
    setDrag(null);
  };

  const markerDelta = (ref: KeyframeRef): number => {
    if (!drag) return 0;
    return drag.refs.some((candidate) =>
      candidate.clipId === ref.clipId && candidate.partId === ref.partId && candidate.frame === ref.frame,
    ) ? drag.delta : 0;
  };

  return { markerDelta, beginMarkerDrag, updateMarkerDrag, finishMarkerDrag, cancelMarkerDrag };
}
