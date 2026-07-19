import { describe, expect, it } from "vitest";
import type { CharacterRigV1, MotionClipV1 } from "@ltypet/character-motion";
import { sampleMotionClip } from "@ltypet/character-motion";
import { createKeyframeClipboard } from "../src/editor/model/documentCommands";
import {
  createEditorHistory,
  executeEditorCommand,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  redoEditorHistory,
  undoEditorHistory,
} from "../src/editor/history/EditorHistory";
import type { EditorDocument, KeyframeRef } from "../src/editor/model/types";

const rig: CharacterRigV1 = {
  schemaVersion: 1,
  rigId: "test-rig",
  artwork: { source: "test.svg", fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", viewBox: [0, 0, 100, 100] },
  renderSlots: ["back", "body", "front"],
  parts: ["body", "arm_right"].map((id) => ({
    id,
    sourceBinding: { kind: "inkscapeLabel" as const, value: id },
    logicalParentId: null,
    defaultRenderSlot: "body",
    pivot: { x: 10, y: 10, space: "partLocal" as const },
    bindMatrix: [1, 0, 0, 1, 0, 0],
  })),
};

const emptyClip: MotionClipV1 = {
  id: "wave",
  fps: 24,
  durationFrames: 24,
  loop: "none",
  tracks: [],
  events: [],
};

function document(): EditorDocument {
  return { rig, motions: { schemaVersion: 1, rigId: rig.rigId, clips: [emptyClip] } };
}

function run(history: ReturnType<typeof createEditorHistory>, command: Parameters<typeof executeEditorCommand>[1]) {
  const result = executeEditorCommand(history, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.history;
}

describe("EditorHistory", () => {
  it("supports commands, undo, redo and a saved checkpoint", () => {
    let history = createEditorHistory(document());
    history = run(history, {
      type: "keyframe.upsert",
      clipId: "wave",
      partId: "arm_right",
      keyframe: { frame: 0, values: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 } },
    });
    expect(isEditorHistoryDirty(history)).toBe(true);
    history = markEditorHistorySaved(history);
    history = run(history, {
      type: "keyframe.upsert",
      clipId: "wave",
      partId: "arm_right",
      keyframe: { frame: 12, values: { rotation: -55 } },
    });
    history = undoEditorHistory(history);
    expect(isEditorHistoryDirty(history)).toBe(false);
    history = redoEditorHistory(history);
    expect(history.present.motions.clips[0].tracks[0].keyframes).toHaveLength(2);
  });

  it("clears redo after a divergent edit and enforces the history limit", () => {
    let history = createEditorHistory(document(), 2);
    history = run(history, { type: "rig.updatePivot", partId: "arm_right", x: 1, y: 2 });
    history = run(history, { type: "rig.updatePivot", partId: "arm_right", x: 2, y: 3 });
    history = run(history, { type: "rig.updatePivot", partId: "arm_right", x: 3, y: 4 });
    expect(history.past).toHaveLength(2);
    history = undoEditorHistory(history);
    history = run(history, { type: "rig.updatePivot", partId: "arm_right", x: 9, y: 9 });
    expect(history.future).toHaveLength(0);
  });
});

describe("keyframe document commands", () => {
  function seeded() {
    let history = createEditorHistory(document());
    for (const [frame, rotation] of [[0, 0], [12, -55], [24, 0]] as const) {
      history = run(history, {
        type: "keyframe.upsert",
        clipId: "wave",
        partId: "arm_right",
        keyframe: { frame, values: { rotation } },
      });
    }
    return history;
  }

  it("moves multiple keyframes atomically and rejects conflicts", () => {
    let history = seeded();
    const refs: KeyframeRef[] = [
      { clipId: "wave", partId: "arm_right", frame: 0 },
      { clipId: "wave", partId: "arm_right", frame: 12 },
    ];
    const conflict = executeEditorCommand(history, { type: "keyframe.moveMany", refs, deltaFrames: 12 });
    expect(conflict).toMatchObject({ ok: false });
    expect(history.present.motions.clips[0].tracks[0].keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 12, 24]);
    history = run(history, { type: "keyframe.moveMany", refs: [refs[1]], deltaFrames: 1 });
    expect(history.present.motions.clips[0].tracks[0].keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 13, 24]);
  });

  it("copies relative offsets and refuses partial paste", () => {
    let history = seeded();
    const refs: KeyframeRef[] = [
      { clipId: "wave", partId: "arm_right", frame: 0 },
      { clipId: "wave", partId: "arm_right", frame: 12 },
    ];
    const copied = createKeyframeClipboard(history.present, refs);
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.value.entries.map((entry) => entry.frameOffset)).toEqual([0, 12]);
    const failed = executeEditorCommand(history, {
      type: "keyframe.paste",
      clipId: "wave",
      targetFrame: 12,
      clipboard: copied.value,
    });
    expect(failed).toMatchObject({ ok: false });
    expect(history.present.motions.clips[0].tracks[0].keyframes).toHaveLength(3);
  });

  it("inserts a full sampled pose like F6", () => {
    let history = seeded();
    const clip = history.present.motions.clips[0];
    const sampled = sampleMotionClip(clip, 6, rig).transforms.get("arm_right")!;
    history = run(history, {
      type: "keyframe.upsert",
      clipId: "wave",
      partId: "arm_right",
      keyframe: { frame: 6, values: sampled },
      merge: false,
    });
    expect(history.present.motions.clips[0].tracks[0].keyframes.find((keyframe) => keyframe.frame === 6)?.values)
      .toEqual(expect.objectContaining({ rotation: -27.5, scaleX: 1, opacity: 1 }));
  });

  it("adds and removes a discrete renderSlot without deleting numeric pose values", () => {
    let history = seeded();
    history = run(history, {
      type: "keyframe.upsert",
      clipId: "wave",
      partId: "arm_right",
      keyframe: { frame: 0, values: { renderSlot: "front" } },
    });
    history = run(history, {
      type: "keyframe.removeValues",
      clipId: "wave",
      partId: "arm_right",
      frame: 0,
      properties: ["renderSlot"],
    });
    expect(history.present.motions.clips[0].tracks[0].keyframes[0].values)
      .toEqual({ rotation: 0 });
  });
});
