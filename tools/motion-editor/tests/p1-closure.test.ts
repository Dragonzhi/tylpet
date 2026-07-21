import { describe, expect, it, vi } from "vitest";

vi.mock("@svgedit/svgcanvas", () => ({
  default: class MockSvgCanvas {},
}));
import { serializeMotionLibrary, sha256CanonicalText } from "@ltypet/character-motion";
import type { CharacterRigV1, MotionLibraryV1 } from "@ltypet/character-motion";
import {
  findSourceBindingMatches,
  inspectSvgForImport,
} from "../src/import/inspectSvgForImport";
import {
  buildRigFromImport,
  createWaveExample,
  firstPlayableTrack,
  parseMotionLibraryForRig,
  parseRigForArtwork,
  parseV1Project,
} from "../src/project/v1Project";
import {
  SvgCanvasAdapter,
  type ImportResult,
  type ImportedPartRef,
} from "../src/svgcanvas/SvgCanvasAdapter";

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

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://example.com/a.css";</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import/**/url(https://example.com/a.css);</style></svg>',
    '<html xmlns="http://www.w3.org/1999/xhtml"><svg xmlns="http://www.w3.org/2000/svg"/></html>',
    '<svg xmlns="urn:not-svg"/>',
  ])("rejects unsafe or invalid SVG roots and CSS imports: %s", (svg) => {
    expect(inspectSvgForImport(svg).hasError).toBe(true);
  });
});

describe("P4-1 production project opening", () => {
  const artwork = `<svg xmlns="http://www.w3.org/2000/svg"
    xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
    viewBox="0 0 100 200">
    <g id="source-head" inkscape:label="painted-head"/>
    <g id="source-arm" data-part="painted-arm"/>
    <g id="source-body"/>
  </svg>`;

  async function makeProductionFiles(): Promise<{
    rig: CharacterRigV1;
    motions: MotionLibraryV1;
  }> {
    const fingerprint = await sha256CanonicalText(artwork);
    const part = (
      id: string,
      sourceBinding: CharacterRigV1["parts"][number]["sourceBinding"],
    ): CharacterRigV1["parts"][number] => ({
      id,
      sourceBinding,
      logicalParentId: null,
      defaultRenderSlot: "body",
      pivot: { x: 0, y: 0, space: "partLocal" },
      bindMatrix: [1, 0, 0, 1, 0, 0],
    });
    const rig: CharacterRigV1 = {
      schemaVersion: 1,
      rigId: "production-rig",
      artwork: { source: "artwork.svg", fingerprint, viewBox: [0, 0, 100, 200] },
      renderSlots: ["body"],
      parts: [
        part("semantic-head", { kind: "inkscapeLabel", value: "painted-head" }),
        part("semantic-arm", { kind: "dataPart", value: "painted-arm" }),
        part("semantic-body", { kind: "elementId", value: "source-body" }),
      ],
    };
    return {
      rig,
      motions: {
        schemaVersion: 1,
        rigId: rig.rigId,
        clips: [{
          id: "wave",
          fps: 24,
          durationFrames: 1,
          loop: "none",
          tracks: [{
            partId: "semantic-arm",
            keyframes: [{ frame: 0, values: { rotation: 0 } }],
          }],
          events: [],
        }],
      },
    };
  }

  it("opens artwork, rig, and motions with semantic Part IDs independent of bindings", async () => {
    const files = await makeProductionFiles();
    const project = await parseV1Project({
      artwork,
      artworkSource: "artwork.svg",
      rig: JSON.stringify(files.rig),
      motions: JSON.stringify(files.motions),
    });
    expect(project.rig.parts.map((part) => part.id)).toEqual([
      "semantic-head",
      "semantic-arm",
      "semantic-body",
    ]);
    expect(project.motions.rigId).toBe("production-rig");
  });

  it("finds every v1 source binding kind exactly", () => {
    const inspection = inspectSvgForImport(artwork);
    expect(inspection.root).not.toBeNull();
    const root = inspection.root!;
    expect(findSourceBindingMatches(root, { kind: "inkscapeLabel", value: "painted-head" })[0].id)
      .toBe("source-head");
    expect(findSourceBindingMatches(root, { kind: "dataPart", value: "painted-arm" })[0].id)
      .toBe("source-arm");
    expect(findSourceBindingMatches(root, { kind: "elementId", value: "source-body" })[0].id)
      .toBe("source-body");
  });

  it("binds the adapter index by semantic Part ID instead of source labels", async () => {
    const files = await makeProductionFiles();
    const inspection = inspectSvgForImport(artwork);
    const selected: SVGElement[][] = [];
    const adapter = new SvgCanvasAdapter();
    Object.assign(adapter as unknown as Record<string, unknown>, {
      canvas: {
        getSvgRoot: () => inspection.root,
        getSvgContent: () => inspection.root,
        selectOnly: (elements: SVGElement[]) => selected.push(elements),
      },
    });

    const bound = adapter.bindRig(files.rig);
    expect(bound.diagnostics.some((item) => item.severity === "error")).toBe(false);
    expect(bound.parts.map((part) => part.partId)).toEqual([
      "semantic-head",
      "semantic-arm",
      "semantic-body",
    ]);
    expect(adapter.selectPart("painted-head")).toBe(false);
    expect(adapter.selectPart("semantic-head")).toBe(true);
    expect(selected[0][0].id).toBe("source-head");
  });

  it.each([
    ["fingerprint", async (rig: CharacterRigV1, motions: MotionLibraryV1) => {
      rig.artwork.fingerprint = `sha256:${"0".repeat(64)}`;
      return { rig, motions, artworkSource: "artwork.svg" };
    }],
    ["source", async (rig: CharacterRigV1, motions: MotionLibraryV1) => ({
      rig, motions, artworkSource: "other.svg",
    })],
    ["viewBox", async (rig: CharacterRigV1, motions: MotionLibraryV1) => {
      rig.artwork.viewBox = [0, 0, 100, 201];
      return { rig, motions, artworkSource: "artwork.svg" };
    }],
    ["rigId", async (rig: CharacterRigV1, motions: MotionLibraryV1) => {
      motions.rigId = "other-rig";
      return { rig, motions, artworkSource: "artwork.svg" };
    }],
    ["binding", async (rig: CharacterRigV1, motions: MotionLibraryV1) => {
      rig.parts[0].sourceBinding.value = "missing-label";
      return { rig, motions, artworkSource: "artwork.svg" };
    }],
  ])("rejects a production project with mismatched %s", async (_name, mutate) => {
    const files = await makeProductionFiles();
    const changed = await mutate(structuredClone(files.rig), structuredClone(files.motions));
    await expect(parseV1Project({
      artwork,
      artworkSource: changed.artworkSource,
      rig: changed.rig,
      motions: changed.motions,
    })).rejects.toThrow();
  });

  it("rejects a binding that matches multiple DOM nodes", async () => {
    const duplicatedArtwork = artwork.replace(
      '<g id="source-arm" data-part="painted-arm"/>',
      '<g id="source-arm" data-part="painted-arm"/><g id="source-arm-copy" data-part="painted-arm"/>',
    );
    const files = await makeProductionFiles();
    files.rig.artwork.fingerprint = await sha256CanonicalText(duplicatedArtwork);
    await expect(parseV1Project({
      artwork: duplicatedArtwork,
      artworkSource: "artwork.svg",
      rig: files.rig,
      motions: files.motions,
    })).rejects.toThrow("命中 2 个节点");
  });

  it("rejects two Parts that resolve to the same DOM node", async () => {
    const files = await makeProductionFiles();
    files.rig.parts[2].sourceBinding = { kind: "elementId", value: "source-head" };
    await expect(parseV1Project({
      artwork,
      artworkSource: "artwork.svg",
      rig: files.rig,
      motions: files.motions,
    })).rejects.toThrow("绑定到同一素材节点");
  });
});
