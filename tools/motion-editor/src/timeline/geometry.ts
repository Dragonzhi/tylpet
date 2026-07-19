export function frameToTimelineX(frame: number, pixelsPerFrame: number): number {
  return frame * pixelsPerFrame;
}

export function timelineXToFrame(
  x: number,
  pixelsPerFrame: number,
  durationFrames: number,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(pixelsPerFrame) || pixelsPerFrame <= 0) return 0;
  return Math.max(0, Math.min(durationFrames, Math.round(x / pixelsPerFrame)));
}

export function clampKeyframeDelta(
  frames: number[],
  requestedDelta: number,
  durationFrames: number,
): number {
  if (frames.length === 0) return 0;
  const min = Math.min(...frames);
  const max = Math.max(...frames);
  const result = Math.max(-min, Math.min(durationFrames - max, Math.round(requestedDelta)));
  return Object.is(result, -0) ? 0 : result;
}
