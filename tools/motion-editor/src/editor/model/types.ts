import type {
  CharacterRigV1,
  MotionClipV1,
  MotionKeyframeV1,
  MotionLibraryV1,
  ProceduralChannel,
  SourceBinding,
} from "@ltypet/character-motion";

export interface EditorDocument {
  rig: CharacterRigV1;
  motions: MotionLibraryV1;
}

export interface KeyframeRef {
  clipId: string;
  partId: string;
  frame: number;
}

export interface ClipboardKeyframe {
  partId: string;
  frameOffset: number;
  keyframe: MotionKeyframeV1;
}

export interface KeyframeClipboard {
  sourceClipId: string;
  entries: ClipboardKeyframe[];
}

export interface ClipMetaPatch {
  id?: string;
  fps?: number;
  durationFrames?: number;
  loop?: MotionClipV1["loop"];
  suppressProceduralChannels?: ProceduralChannel[];
}

export type EditorCommand =
  | { type: "clip.add"; clip: MotionClipV1 }
  | { type: "clip.updateMeta"; clipId: string; patch: ClipMetaPatch }
  | { type: "clip.delete"; clipId: string }
  | {
    type: "keyframe.upsert";
    clipId: string;
    partId: string;
    keyframe: MotionKeyframeV1;
    merge?: boolean;
  }
  | {
    type: "keyframe.removeValues";
    clipId: string;
    partId: string;
    frame: number;
    properties: Array<keyof MotionKeyframeV1["values"]>;
  }
  | { type: "keyframe.deleteMany"; refs: KeyframeRef[] }
  | { type: "keyframe.moveMany"; refs: KeyframeRef[]; deltaFrames: number }
  | {
    type: "keyframe.adjustMany";
    refs: KeyframeRef[];
    property: keyof Omit<MotionKeyframeV1["values"], "renderSlot">;
    delta: number;
  }
  | { type: "keyframe.paste"; clipId: string; targetFrame: number; clipboard: KeyframeClipboard }
  | { type: "rig.updatePivot"; partId: string; x: number; y: number }
  | { type: "rig.renamePart"; partId: string; nextPartId: string }
  | { type: "rig.updateSourceBinding"; partId: string; sourceBinding: SourceBinding }
  | { type: "rig.reparent"; partId: string; logicalParentId: string | null }
  | { type: "rig.updateDefaultRenderSlot"; partId: string; renderSlot: string };

export type EditorCommandResult =
  | { ok: true; document: EditorDocument }
  | { ok: false; error: string };
