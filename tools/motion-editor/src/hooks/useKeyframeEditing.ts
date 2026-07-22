import { useCallback, useMemo } from "react";
import { sampleMotionClip } from "@ltypet/character-motion";
import type {
  EasingValue,
  MotionClipV1,
  MotionKeyframeV1,
  TransformValue,
} from "@ltypet/character-motion";
import type { CharacterRigV1 } from "@ltypet/character-motion";
import type {
  KeyframeClipboard,
  KeyframeRef,
  EditorCommand,
} from "../editor/model/types";
import { createKeyframeClipboard } from "../editor/model/documentCommands";
import { keyframeRefKey } from "../lib/keyframeRef";
import type { SvgCanvasAdapter } from "../svgcanvas/SvgCanvasAdapter";

const DEFAULT_TRANSFORM: TransformValue = {
  x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
};

export interface UseKeyframeEditingOptions {
  adapterRef: React.RefObject<SvgCanvasAdapter | null>;
  rig: CharacterRigV1 | null;
  activeClip: MotionClipV1 | null;
  selectedPartId: string | null;
  setSelectedPartId: (partId: string | null) => void;
  selectedKeyframes: KeyframeRef[];
  setSelectedKeyframes: (keyframes: KeyframeRef[] | ((prev: KeyframeRef[]) => KeyframeRef[])) => void;
  clipboard: KeyframeClipboard | null;
  setClipboard: (clipboard: KeyframeClipboard | null) => void;
  transformDraft: { partId: string; value: TransformValue } | null;
  setTransformDraft: (draft: { partId: string; value: TransformValue } | null) => void;
  pivotDraft: { partId: string; x: number; y: number } | null;
  setPivotDraft: (draft: { partId: string; x: number; y: number } | null) => void;
  currentFrame: number;
  setCurrentFrame: (frame: number | ((prev: number) => number)) => void;
  history: ReturnType<typeof import("../editor/history/EditorHistory").createEditorHistory> | null;
  runCommand: (command: EditorCommand) => boolean;
  addLog: (message: string) => void;
  requestGeometry: () => void;
}

export function useKeyframeEditing({
  adapterRef, rig, activeClip, selectedPartId, setSelectedPartId,
  selectedKeyframes, setSelectedKeyframes,
  clipboard, setClipboard,
  transformDraft, setTransformDraft, pivotDraft, setPivotDraft,
  currentFrame, setCurrentFrame,
  history, runCommand, addLog, requestGeometry,
}: UseKeyframeEditingOptions) {

  const sampledTransform = useMemo(() => {
    if (!activeClip || !rig || !selectedPartId) return null;
    return sampleMotionClip(activeClip, currentFrame, rig).transforms.get(selectedPartId) ?? DEFAULT_TRANSFORM;
  }, [activeClip, currentFrame, rig, selectedPartId]);

  const displayedTransform = transformDraft?.partId === selectedPartId
    ? transformDraft.value
    : sampledTransform;

  const exactKeyframe = useMemo(() => activeClip?.tracks
    .find((track) => track.partId === selectedPartId)
    ?.keyframes.find((keyframe) => keyframe.frame === currentFrame) ?? null,
  [activeClip, currentFrame, selectedPartId]);

  const displayedPivot = useMemo(() => {
    if (!rig || !selectedPartId) return null;
    if (pivotDraft?.partId === selectedPartId) return { x: pivotDraft.x, y: pivotDraft.y };
    return rig.parts.find((part) => part.id === selectedPartId)?.pivot ?? null;
  }, [pivotDraft, rig, selectedPartId]);

  const selectPart = useCallback((partId: string) => {
    setSelectedPartId(partId);
    setSelectedKeyframes([]);
    adapterRef.current?.selectPart(partId);
    requestAnimationFrame(requestGeometry);
  }, [adapterRef, requestGeometry, setSelectedPartId, setSelectedKeyframes]);

  const insertCurrentKeyframe = useCallback(() => {
    if (!activeClip || !selectedPartId || !sampledTransform) return;
    runCommand({
      type: "keyframe.upsert",
      clipId: activeClip.id,
      partId: selectedPartId,
      keyframe: {
        frame: currentFrame,
        values: { ...sampledTransform, ...(exactKeyframe?.values.renderSlot ? { renderSlot: exactKeyframe.values.renderSlot } : {}) },
        ...(exactKeyframe?.easing ? { easing: exactKeyframe.easing } : {}),
      },
      merge: false,
    });
  }, [activeClip, currentFrame, exactKeyframe, runCommand, sampledTransform, selectedPartId]);

  const deleteCurrentKeyframe = useCallback(() => {
    if (!activeClip || !selectedPartId || !exactKeyframe) return;
    runCommand({
      type: "keyframe.deleteMany",
      refs: [{ clipId: activeClip.id, partId: selectedPartId, frame: currentFrame }],
    });
    setSelectedKeyframes([]);
  }, [activeClip, currentFrame, exactKeyframe, runCommand, selectedPartId, setSelectedKeyframes]);

  const updateCurrentValues = useCallback((values: Partial<MotionKeyframeV1["values"]>) => {
    if (!activeClip || !selectedPartId || !exactKeyframe) return;
    runCommand({
      type: "keyframe.upsert",
      clipId: activeClip.id,
      partId: selectedPartId,
      keyframe: { frame: currentFrame, values, ...(exactKeyframe.easing ? { easing: exactKeyframe.easing } : {}) },
      merge: true,
    });
  }, [activeClip, currentFrame, exactKeyframe, runCommand, selectedPartId]);

  const updateCurrentEasing = useCallback((easing: EasingValue) => {
    if (!activeClip || !selectedPartId || !exactKeyframe) return;
    runCommand({
      type: "keyframe.upsert",
      clipId: activeClip.id,
      partId: selectedPartId,
      keyframe: { frame: currentFrame, values: exactKeyframe.values, easing },
      merge: true,
    });
  }, [activeClip, currentFrame, exactKeyframe, runCommand, selectedPartId]);

  const commitTransform = useCallback((value: TransformValue) => {
    setTransformDraft(null);
    updateCurrentValues(value);
  }, [setTransformDraft, updateCurrentValues]);

  const commitPivot = useCallback((x: number, y: number) => {
    if (!selectedPartId) return;
    setPivotDraft(null);
    runCommand({ type: "rig.updatePivot", partId: selectedPartId, x, y });
  }, [runCommand, selectedPartId, setPivotDraft]);

  const selectKeyframe = useCallback((ref: KeyframeRef, modifiers: { toggle: boolean; range: boolean }) => {
    selectPart(ref.partId);
    setCurrentFrame(ref.frame);
    setSelectedKeyframes((previous) => {
      const key = keyframeRefKey;
      if (modifiers.range) {
        const anchor = [...previous].reverse().find(
          (candidate) => candidate.clipId === ref.clipId && candidate.partId === ref.partId,
        );
        const track = activeClip?.tracks.find((candidate) => candidate.partId === ref.partId);
        if (anchor && track) {
          const min = Math.min(anchor.frame, ref.frame);
          const max = Math.max(anchor.frame, ref.frame);
          return track.keyframes.filter((kf) => kf.frame >= min && kf.frame <= max)
            .map((kf) => ({ clipId: ref.clipId, partId: ref.partId, frame: kf.frame }));
        }
      }
      if (modifiers.toggle) {
        return previous.some((candidate) => key(candidate) === key(ref))
          ? previous.filter((candidate) => key(candidate) !== key(ref))
          : [...previous, ref];
      }
      return [ref];
    });
  }, [activeClip, selectPart, setCurrentFrame, setSelectedKeyframes]);

  const moveKeyframes = useCallback((refs: KeyframeRef[], deltaFrames: number) => {
    if (runCommand({ type: "keyframe.moveMany", refs, deltaFrames })) {
      setSelectedKeyframes(refs.map((ref) => ({ ...ref, frame: ref.frame + deltaFrames })));
      if (refs.some((ref) => ref.partId === selectedPartId && ref.frame === currentFrame)) {
        setCurrentFrame((frame) => frame + deltaFrames);
      }
    }
  }, [currentFrame, runCommand, selectedPartId, setCurrentFrame, setSelectedKeyframes]);

  const copySelected = useCallback(() => {
    if (!history) return;
    const result = createKeyframeClipboard(history.present, selectedKeyframes);
    if (!result.ok) addLog(`[错误] ${result.error}`);
    else {
      setClipboard(result.value);
      addLog(`[信息] 已复制 ${result.value.entries.length} 个关键帧`);
    }
  }, [addLog, history, selectedKeyframes, setClipboard]);

  const pasteSelected = useCallback(() => {
    if (!activeClip || !clipboard) return;
    runCommand({ type: "keyframe.paste", clipId: activeClip.id, targetFrame: currentFrame, clipboard });
  }, [activeClip, clipboard, currentFrame, runCommand]);

  const deleteSelected = useCallback(() => {
    if (selectedKeyframes.length === 0) return;
    if (runCommand({ type: "keyframe.deleteMany", refs: selectedKeyframes })) setSelectedKeyframes([]);
  }, [runCommand, selectedKeyframes, setSelectedKeyframes]);

  return {
    sampledTransform,
    displayedTransform,
    exactKeyframe,
    displayedPivot,
    selectPart,
    insertCurrentKeyframe,
    deleteCurrentKeyframe,
    updateCurrentValues,
    updateCurrentEasing,
    commitTransform,
    commitPivot,
    selectKeyframe,
    moveKeyframes,
    copySelected,
    pasteSelected,
    deleteSelected,
  };
}
