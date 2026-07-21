import { describe, expect, it } from "vitest";
import { reconcilePartRename } from "../src/editor/session/reconcilePartRename";

describe("reconcilePartRename", () => {
  it("updates all App session references after a successful rename", () => {
    const result = reconcilePartRename({
      selectedPartId: "arm",
      hiddenPartIds: new Set(["body", "arm"]),
      lockedPartIds: new Set(["arm"]),
      selectedKeyframes: [
        { clipId: "wave", partId: "arm", frame: 3 },
        { clipId: "wave", partId: "body", frame: 4 },
      ],
      clipboard: {
        sourceClipId: "wave",
        entries: [{
          partId: "arm",
          frameOffset: 0,
          keyframe: { frame: 3, values: { rotation: 10 } },
        }],
      },
    }, "arm", "arm_right");

    expect(result.selectedPartId).toBe("arm_right");
    expect([...result.hiddenPartIds]).toEqual(["body", "arm_right"]);
    expect([...result.lockedPartIds]).toEqual(["arm_right"]);
    expect(result.selectedKeyframes.map((ref) => ref.partId)).toEqual(["arm_right", "body"]);
    expect(result.clipboard?.entries[0].partId).toBe("arm_right");
  });

  it("returns the same session when the IDs are unchanged", () => {
    const session = {
      selectedPartId: "arm",
      hiddenPartIds: new Set<string>(),
      lockedPartIds: new Set<string>(),
      selectedKeyframes: [],
      clipboard: null,
    };

    expect(reconcilePartRename(session, "arm", "arm")).toBe(session);
  });
});
