import { describe, expect, it } from "vitest";
import type {
  CharacterRigV1,
  MotionClipV1,
  SourceBinding,
} from "@ltypet/character-motion";
import {
  approximatelyEqual,
  resolveWorldBindMatrices,
} from "@ltypet/character-motion";
import {
  createEditorHistory,
  executeEditorCommand,
  undoEditorHistory,
} from "../src/editor/history/EditorHistory";
import type { EditorCommand, EditorDocument } from "../src/editor/model/types";

const rig: CharacterRigV1 = {
  schemaVersion: 1,
  rigId: "test-rig",
  artwork: {
    source: "test.svg",
    fingerprint: `sha256:${"a".repeat(64)}`,
    viewBox: [0, 0, 100, 100],
  },
  renderSlots: ["body", "front"],
  parts: [
    {
      id: "body",
      sourceBinding: { kind: "inkscapeLabel", value: "body" },
      logicalParentId: null,
      defaultRenderSlot: "body",
      pivot: { x: 0, y: 0, space: "partLocal" },
      bindMatrix: [-1, 0, 0, 1.5, 20, -10],
    },
    {
      id: "arm_right",
      sourceBinding: { kind: "inkscapeLabel", value: "arm_right" },
      logicalParentId: "body",
      defaultRenderSlot: "body",
      pivot: { x: 10, y: 10, space: "partLocal" },
      bindMatrix: [1, 0.25, 0, 0.75, 10, 0],
    },
  ],
};

const clip: MotionClipV1 = {
  id: "wave",
  fps: 24,
  durationFrames: 24,
  loop: "none",
  tracks: [
    { partId: "body", keyframes: [{ frame: 0, values: { x: 1 } }] },
    { partId: "arm_right", keyframes: [{ frame: 0, values: { rotation: -10 } }] },
  ],
  events: [],
};

function document(): EditorDocument {
  return {
    rig,
    motions: { schemaVersion: 1, rigId: rig.rigId, clips: [clip] },
  };
}

function run(
  history: ReturnType<typeof createEditorHistory>,
  command: EditorCommand,
) {
  const result = executeEditorCommand(history, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.history;
}

describe("rig document commands", () => {
  it("renames production references atomically and undoes in one step", () => {
    let history = createEditorHistory(document());
    history = run(history, {
      type: "rig.renamePart",
      partId: "body",
      nextPartId: "torso",
    });

    expect(history.past).toHaveLength(1);
    expect(history.present.rig.parts.map((part) => part.id)).toContain("torso");
    expect(history.present.rig.parts[1].logicalParentId).toBe("torso");
    expect(history.present.motions.clips[0].tracks.map((track) => track.partId))
      .toEqual(["torso", "arm_right"]);

    history = undoEditorHistory(history);
    expect(history.present.rig.parts.map((part) => part.id)).toContain("body");
    expect(history.present.rig.parts[1].logicalParentId).toBe("body");
    expect(history.present.motions.clips[0].tracks[0].partId).toBe("body");
  });

  it("rejects rename conflicts without changing history", () => {
    const history = createEditorHistory(document());
    const result = executeEditorCommand(history, {
      type: "rig.renamePart",
      partId: "body",
      nextPartId: "arm_right",
    });
    expect(result).toMatchObject({ ok: false });
    expect(history.past).toHaveLength(0);
    expect(history.present.rig.parts.map((part) => part.id))
      .toEqual(["body", "arm_right"]);
  });

  it("supports all v1 source binding kinds and rejects duplicates", () => {
    let history = createEditorHistory(document());
    const bindings: SourceBinding[] = [
      { kind: "inkscapeLabel", value: "right-arm-label" },
      { kind: "elementId", value: "right-arm-node" },
      { kind: "dataPart", value: "right-arm-data" },
    ];
    for (const sourceBinding of bindings) {
      history = run(history, {
        type: "rig.updateSourceBinding",
        partId: "arm_right",
        sourceBinding,
      });
      expect(history.present.rig.parts[1].sourceBinding).toEqual(sourceBinding);
    }

    const duplicate = executeEditorCommand(history, {
      type: "rig.updateSourceBinding",
      partId: "arm_right",
      sourceBinding: history.present.rig.parts[0].sourceBinding,
    });
    expect(duplicate).toMatchObject({ ok: false });
    expect(history.present.rig.parts[1].sourceBinding).toEqual(bindings[2]);
  });

  it("reparents while preserving frame-zero world bind pose", () => {
    let history = createEditorHistory(document());
    const before = resolveWorldBindMatrices(history.present.rig).get("arm_right")!;
    history = run(history, {
      type: "rig.reparent",
      partId: "arm_right",
      logicalParentId: null,
    });
    const after = resolveWorldBindMatrices(history.present.rig).get("arm_right")!;

    expect(history.present.rig.parts[1].logicalParentId).toBeNull();
    expect(approximatelyEqual(after, before)).toBe(true);
  });

  it("does not create history when the logical parent is unchanged", () => {
    const history = createEditorHistory(document());
    const result = executeEditorCommand(history, {
      type: "rig.reparent",
      partId: "arm_right",
      logicalParentId: "body",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.history).toBe(history);
  });

  it("rejects reparent cycles without changing the document", () => {
    const history = createEditorHistory(document());
    const result = executeEditorCommand(history, {
      type: "rig.reparent",
      partId: "body",
      logicalParentId: "arm_right",
    });
    expect(result).toMatchObject({ ok: false });
    expect(history.present.rig.parts[0].logicalParentId).toBeNull();
    expect(history.past).toHaveLength(0);
  });

  it("updates default render slot and rejects an unknown slot", () => {
    let history = createEditorHistory(document());
    history = run(history, {
      type: "rig.updateDefaultRenderSlot",
      partId: "arm_right",
      renderSlot: "front",
    });
    expect(history.present.rig.parts[1].defaultRenderSlot).toBe("front");

    const invalid = executeEditorCommand(history, {
      type: "rig.updateDefaultRenderSlot",
      partId: "arm_right",
      renderSlot: "missing",
    });
    expect(invalid).toMatchObject({ ok: false });
    expect(history.present.rig.parts[1].defaultRenderSlot).toBe("front");
  });
});
