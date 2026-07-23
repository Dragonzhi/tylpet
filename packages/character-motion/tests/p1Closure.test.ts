import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  serializeMotionLibrary,
  serializeRig,
  sha256CanonicalText,
  validateMotionLibrary,
  validateRig,
  validateRigStructure,
} from "../src/index.js";
import type { CharacterRigV1, MotionLibraryV1 } from "../src/types.js";

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

describe("P1 real fixtures", () => {
  it("validates the generated xiaoluobao rig and exported wave", async () => {
    const rigResult = validateRig(readJson("../../../src/assets/character/xiaoluobao/rig.v1.json"));
    expect(rigResult.ok).toBe(true);
    if (!rigResult.ok) return;

    const artwork = readFileSync(
      new URL("../../../src/assets/character/xiaoluobao/artwork.svg", import.meta.url),
      "utf8",
    );
    expect(rigResult.value.artwork.fingerprint).toBe(await sha256CanonicalText(artwork));
    expect(rigResult.value.artwork.viewBox).toEqual([0, 0, 33.790157, 53.378078]);
    expect(rigResult.value.parts.length).toBeGreaterThan(30);
    expect(rigResult.value.parts.find((part) => part.id === "arm_right")?.pivot.x).toBeCloseTo(19.20331);

    const motionResult = validateMotionLibrary(
      readJson("../../../src/assets/character/xiaoluobao/motions.v1.json"),
      rigResult.value,
    );
    expect(motionResult.ok).toBe(true);
  });

  it("validates every declared valid fixture and rejects every invalid rig fixture", () => {
    for (const name of ["minimal-second-outfit.rig.v1.json"]) {
      expect(validateRig(readJson(`../fixtures/valid/${name}`)).ok, name).toBe(true);
    }
    for (const name of ["duplicate-part.json", "cyclic-parent.json", "unknown-slot.json", "singular-bind-matrix.json"]) {
      expect(validateRig(readJson(`../fixtures/invalid/${name}`)).ok, name).toBe(false);
    }
  });
});

describe("P1 strict schema and canonicalization", () => {
  const rig = validateRig(readJson("../../../src/assets/character/xiaoluobao/rig.v1.json"));
  if (!rig.ok) throw new Error("test fixture must be valid");

  it("rejects invalid viewBox, names, numeric ranges, and empty keyframe values", () => {
    const invalidViewBox = structuredClone(rig.value);
    invalidViewBox.artwork.viewBox[2] = 0;
    expect(validateRigStructure(invalidViewBox).ok).toBe(false);

    const invalidMotion: unknown = {
      schemaVersion: 1,
      rigId: "xiaoluobao",
      clips: [{
        id: "bad",
        fps: 24,
        durationFrames: 10,
        loop: "none",
        tracks: [{ partId: "arm_right", keyframes: [{ frame: 0, values: { opacity: 2 } }] }],
        events: [],
      }],
    };
    expect(validateMotionLibrary(invalidMotion, rig.value).ok).toBe(false);
  });

  it("rejects duplicate and out-of-range keyframes/events", () => {
    const invalid: MotionLibraryV1 = {
      schemaVersion: 1,
      rigId: "xiaoluobao",
      clips: [{
        id: "bad",
        fps: 24,
        durationFrames: 10,
        loop: "none",
        tracks: [{
          partId: "arm_right",
          keyframes: [
            { frame: 11, values: { rotation: 0 } },
            { frame: 11, values: { rotation: 1 } },
          ],
        }],
        events: [{ frame: 12, type: "custom", payload: { name: "late" } }],
      }],
    };
    const result = validateMotionLibrary(invalid, rig.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "duplicate-keyframe-frame",
      "keyframe-out-of-range",
      "event-out-of-range",
    ]));
  });

  it("keeps full motion libraries byte-stable and rejects non-finite serialization", () => {
    const library = readJson("../../../src/assets/character/xiaoluobao/motions.v1.json") as MotionLibraryV1;
    const first = serializeMotionLibrary(library);
    const second = serializeMotionLibrary(JSON.parse(first) as MotionLibraryV1);
    expect(second).toBe(first);

    const invalidRig = structuredClone(rig.value) as CharacterRigV1;
    invalidRig.parts[0].pivot.x = Number.POSITIVE_INFINITY;
    expect(() => serializeRig(invalidRig)).toThrow("non-finite");

    const invalidMotion = structuredClone(library);
    invalidMotion.clips[0].events.push({
      frame: 0,
      type: "custom",
      payload: { amount: Number.NaN },
    });
    expect(() => serializeMotionLibrary(invalidMotion)).toThrow("non-finite");
  });
});
