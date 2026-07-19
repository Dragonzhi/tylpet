import { describe, expect, it } from "vitest";
import { serializeMotionLibrary } from "@ltypet/character-motion";
import type { MotionLibraryV1 } from "@ltypet/character-motion";
import { inspectSvgForImport } from "../src/import/inspectSvgForImport";
import {
  buildRigFromImport,
  createWaveExample,
  firstPlayableTrack,
  parseMotionLibraryForRig,
  parseRigForArtwork,
} from "../src/project/v1Project";
import type { ImportResult, ImportedPartRef } from "../src/svgcanvas/SvgCanvasAdapter";

function makePart(partId: string, pivot: { x: number; y: number }): {
  part: ImportedPartRef;
  pivot: [string, { x: number; y: number }];
} {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "g");
  element.id = `${partId}-element`;
  return {
    part: {
      partId,
      inkscapeLabel: partId,
      sourceElementId: element.id,
      element,
      bindMatrix: [1, 0, 0, 1, 0, 0],
      originalTransform: null,
      originalOpacity: null,
      originalDisplay: null,
      sourceOrder: 0,
      originalParent: element.parentNode,
      originalNextSibling: element.nextSibling,
    },
    pivot: [partId, pivot],
  };
}

function makeRig() {
  const arm = makePart("arm_right", { x: 19, y: 35 });
  const head = makePart("head", { x: 17, y: 33 });
  const imported: ImportResult = {
    parts: [arm.part, head.part],
    pivotLocal: new Map([arm.pivot, head.pivot]),
    viewBox: [0, 0, 33.790157, 53.378078],
    diagnostics: [],
  };
  return buildRigFromImport(imported, {
    source: "sample.svg",
    fingerprint: "sha256:4386f8841a89c4a814439b59bc294595e97a297e14ddd444415b640f4afffcc3",
  });
}

describe("P1 project lifecycle", () => {
  it("builds a real rig from imported artwork measurements", () => {
    const rig = makeRig();
    expect(rig.artwork.viewBox).toEqual([0, 0, 33.790157, 53.378078]);
    expect(rig.parts).toHaveLength(2);
    expect(rig.parts[0].pivot).toEqual({ x: 19, y: 35, space: "partLocal" });
    expect(rig.parts[0].bindMatrix).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("loads the wave example explicitly instead of attaching it to artwork", () => {
    const library = createWaveExample(makeRig());
    expect(firstPlayableTrack(library)).toMatchObject({ partId: "arm_right" });
  });

  it("validates and preserves a complete multi-clip library on import/export", () => {
    const rig = makeRig();
    const library: MotionLibraryV1 = {
      schemaVersion: 1,
      rigId: rig.rigId,
      clips: [
        ...createWaveExample(rig).clips,
        {
          id: "look",
          fps: 30,
          durationFrames: 30,
          loop: "none",
          tracks: [{
            partId: "head",
            keyframes: [
              { frame: 0, values: { x: 0, opacity: 1, renderSlot: "head" } },
              { frame: 30, values: { x: 2, opacity: 0.8 }, easing: { cubicBezier: [0.2, 0, 0.8, 1] } },
            ],
          }],
          events: [{ frame: 10, type: "custom", payload: { name: "look", strength: 1, enabled: true } }],
          suppressProceduralChannels: ["pointer-follow"],
        },
      ],
    };
    const text = serializeMotionLibrary(library);
    const parsed = parseMotionLibraryForRig(text, rig);
    expect(serializeMotionLibrary(parsed)).toBe(text);
    const look = parsed.clips.find((clip) => clip.id === "look");
    expect(look?.fps).toBe(30);
    expect(look?.events[0].payload).toEqual({ enabled: true, name: "look", strength: 1 });
  });

  it("rejects a motion library for a different rig or unknown part", () => {
    const rig = makeRig();
    const invalid = createWaveExample(rig);
    invalid.rigId = "other";
    expect(() => parseMotionLibraryForRig(JSON.stringify(invalid), rig)).toThrow("rig-id-mismatch");

    invalid.rigId = rig.rigId;
    invalid.clips[0].tracks[0].partId = "missing";
    expect(() => parseMotionLibraryForRig(JSON.stringify(invalid), rig)).toThrow("unknown-track-part");
  });

  it("round-trips a rig only for its exact artwork", () => {
    const importedPart = makePart("arm_right", { x: 19, y: 35 });
    const imported: ImportResult = {
      parts: [importedPart.part],
      pivotLocal: new Map([importedPart.pivot]),
      viewBox: [0, 0, 33.790157, 53.378078],
      diagnostics: [],
    };
    const artwork = {
      source: "sample.svg",
      fingerprint: "sha256:4386f8841a89c4a814439b59bc294595e97a297e14ddd444415b640f4afffcc3",
    };
    const rig = buildRigFromImport(imported, artwork);
    expect(parseRigForArtwork(JSON.stringify(rig), imported, artwork)).toEqual(rig);
    expect(() => parseRigForArtwork(JSON.stringify(rig), imported, { ...artwork, fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }))
      .toThrow("指纹不匹配");
  });
});

describe("P1 SVG import security", () => {
  it.each([
    '<image href="relative.png"/>',
    '<image href="file:///tmp/a.png"/>',
    '<rect fill="url(relative.svg#paint)"/>',
    '<style>.x{fill:url(https://example.com/a.svg)}</style>',
  ])("rejects non-fragment external references: %s", (body) => {
    const result = inspectSvgForImport(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
    expect(result.hasError).toBe(true);
  });

  it("allows same-document fragment references", () => {
    const result = inspectSvgForImport(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="p"/></defs><use href="#p"/></svg>',
    );
    expect(result.hasError).toBe(false);
  });
});
