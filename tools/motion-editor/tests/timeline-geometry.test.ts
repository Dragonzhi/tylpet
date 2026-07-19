import { describe, expect, it } from "vitest";
import {
  clampKeyframeDelta,
  frameToTimelineX,
  timelineXToFrame,
} from "../src/timeline/geometry";

describe("timeline geometry", () => {
  it("maps frames and pixels with integer snapping", () => {
    expect(frameToTimelineX(12, 8)).toBe(96);
    expect(timelineXToFrame(99, 8, 24)).toBe(12);
    expect(timelineXToFrame(-20, 8, 24)).toBe(0);
    expect(timelineXToFrame(999, 8, 24)).toBe(24);
  });

  it("clamps a multi-selection delta as one group", () => {
    expect(clampKeyframeDelta([0, 12], -8, 24)).toBe(0);
    expect(clampKeyframeDelta([12, 24], 8, 24)).toBe(0);
    expect(clampKeyframeDelta([4, 12], -3, 24)).toBe(-3);
  });
});
