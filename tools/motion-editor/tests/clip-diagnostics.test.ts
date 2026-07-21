import { describe, expect, it } from "vitest";
import type { CharacterRigV1, MotionClipV1 } from "@ltypet/character-motion";
import { diagnoseClip } from "../src/editor/model/clipDiagnostics";

const rig: CharacterRigV1 = {
  schemaVersion: 1,
  rigId: "test",
  artwork: { source: "test.svg", fingerprint: `sha256:${"a".repeat(64)}`, viewBox: [0, 0, 10, 10] },
  renderSlots: ["body", "front"],
  parts: [{
    id: "body",
    sourceBinding: { kind: "elementId", value: "body" },
    logicalParentId: null,
    defaultRenderSlot: "body",
    pivot: { x: 0, y: 0, space: "partLocal" },
    bindMatrix: [1, 0, 0, 1, 0, 0],
  }],
};

describe("clip diagnostics", () => {
  it("summarizes malformed and runtime-unsupported clip data", () => {
    const clip = {
      id: "broken",
      fps: 24,
      durationFrames: 12,
      loop: "none",
      tracks: [
        { partId: "body", keyframes: [] },
        { partId: "missing", keyframes: [{ frame: 14, values: { renderSlot: "nowhere" } }] },
      ],
      events: [{ frame: 4, type: "sfx" }, { frame: 13, type: "blink" }],
      suppressProceduralChannels: ["breathing", "invalid-channel"],
    } as unknown as MotionClipV1;

    const summary = diagnoseClip(clip, rig);
    expect(summary.hasErrors).toBe(true);
    expect(summary.counts).toEqual({
      "missing-part": 1,
      "empty-track": 1,
      "out-of-range": 2,
      "invalid-slot": 1,
      "unsupported-event": 1,
      suppression: 2,
    });
    expect(summary.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "unsupported-event", severity: "warn" }),
      expect.objectContaining({ category: "suppression", message: "抑制程序动画：breathing" }),
      expect.objectContaining({ category: "suppression", severity: "error" }),
    ]));
  });

  it("reports a clean clip without synthetic missing-track warnings", () => {
    const summary = diagnoseClip({
      id: "idle",
      fps: 24,
      durationFrames: 12,
      loop: "repeat",
      tracks: [{ partId: "body", keyframes: [{ frame: 0, values: { x: 0 } }] }],
      events: [{ frame: 0, type: "blink" }],
    }, rig);
    expect(summary).toMatchObject({ items: [], hasErrors: false });
  });
});
