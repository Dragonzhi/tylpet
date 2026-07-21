import { describe, expect, it } from "vitest";
import type { MotionClipV1 } from "@ltypet/character-motion";
import {
  getFilteredTimelineRows,
  normalizeTimelineRange,
  pixelsPerFrameForRange,
} from "../src/timeline/model";

const clip: MotionClipV1 = {
  id: "wave",
  fps: 24,
  durationFrames: 48,
  loop: "none",
  tracks: [
    { partId: "body", keyframes: [] },
    { partId: "arm", keyframes: [{ frame: 12, values: { x: 2, rotation: 15 } }] },
  ],
  events: [],
};

describe("timeline model", () => {
  it("filters by part, property and committed-keyframe presence", () => {
    expect(getFilteredTimelineRows(clip, null, {
      partId: null,
      property: null,
      keyedOnly: true,
    })).toEqual([{
      partId: "arm",
      properties: [
        { id: "x", label: "X" },
        { id: "rotation", label: "旋转" },
      ],
    }]);

    expect(getFilteredTimelineRows(clip, "body", {
      partId: "arm",
      property: "rotation",
      keyedOnly: false,
    })).toEqual([{
      partId: "arm",
      properties: [{ id: "rotation", label: "旋转" }],
    }]);
  });

  it("normalizes reversed ranges and computes bounded zoom", () => {
    expect(normalizeTimelineRange(30.2, 10.4, 48)).toEqual({ startFrame: 10, endFrame: 30 });
    expect(normalizeTimelineRange(-10, 99, 48)).toEqual({ startFrame: 0, endFrame: 48 });
    expect(normalizeTimelineRange(12, 12, 48)).toBeNull();
    expect(pixelsPerFrameForRange({ startFrame: 10, endFrame: 30 }, 424)).toBe(20);
    expect(pixelsPerFrameForRange({ startFrame: 0, endFrame: 1 }, 1000)).toBe(24);
  });
});
