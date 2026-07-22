import { useCallback, useEffect, useRef, useState } from "react";
import { sampleMotionClip } from "@ltypet/character-motion";
import type { CharacterRigV1, MotionClipV1, TransformValue } from "@ltypet/character-motion";
import type { SvgCanvasAdapter, PartScreenGeometry } from "../svgcanvas/SvgCanvasAdapter";

export interface UseStagePreviewOptions {
  adapterRef: React.RefObject<SvgCanvasAdapter | null>;
  stageRef: React.RefObject<HTMLElement | null>;
  rig: CharacterRigV1 | null;
  activeClip: MotionClipV1 | null;
  currentFrame: number;
  selectedPartId: string | null;
  transformDraft: { partId: string; value: TransformValue } | null;
  pivotDraft: { partId: string; x: number; y: number } | null;
  hiddenPartIds: Set<string>;
  lockedPartIds: Set<string>;
  stagePan: { x: number; y: number };
}

export function useStagePreview({
  adapterRef, stageRef, rig, activeClip, currentFrame,
  selectedPartId, transformDraft, pivotDraft,
  hiddenPartIds, lockedPartIds, stagePan,
}: UseStagePreviewOptions) {
  const [geometry, setGeometry] = useState<PartScreenGeometry | null>(null);
  const animatedPartsRef = useRef<Set<string>>(new Set());

  const requestGeometry = useCallback(() => {
    const adapter = adapterRef.current;
    const stage = stageRef.current;
    if (!adapter || !stage || !selectedPartId) {
      setGeometry(null);
      return;
    }
    requestAnimationFrame(() => setGeometry(adapter.getPartScreenGeometry(selectedPartId, stage)));
  }, [selectedPartId]);

  // Sample + applyPreview effect
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !activeClip || !rig) return;
    for (const part of rig.parts) {
      const pivot = pivotDraft?.partId === part.id ? pivotDraft : part.pivot;
      adapter.setPivotLocal(part.id, pivot);
    }
    const sampled = sampleMotionClip(activeClip, currentFrame, rig);
    const nextParts = new Set(sampled.transforms.keys());
    for (const previousPart of animatedPartsRef.current) {
      if (!nextParts.has(previousPart)) adapter.restoreBindPose(previousPart);
    }
    for (const [partId, transform] of sampled.transforms) {
      adapter.applyPreviewTransform(partId, transformDraft?.partId === partId ? transformDraft.value : transform);
    }
    adapter.applyRenderSlots(
      new Map(rig.parts.map((part) => [part.id, part.defaultRenderSlot])),
      sampled.renderSlots,
      rig.renderSlots,
    );
    animatedPartsRef.current = nextParts;
    requestGeometry();
  }, [activeClip, currentFrame, pivotDraft, requestGeometry, rig, transformDraft]);

  // Visibility/lock effect
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !rig) return;
    for (const part of rig.parts) {
      adapter.setPartVisible(part.id, !hiddenPartIds.has(part.id));
      adapter.setPartLocked(part.id, lockedPartIds.has(part.id));
    }
    requestGeometry();
  }, [hiddenPartIds, lockedPartIds, requestGeometry, rig]);

  // stagePan → requestGeometry
  useEffect(() => {
    requestGeometry();
  }, [requestGeometry, stagePan]);

  // Resize + ResizeObserver effect
  useEffect(() => {
    const refresh = () => {
      adapterRef.current?.fitArtworkToViewport();
      requestGeometry();
    };
    window.addEventListener("resize", refresh);
    const observer = stageRef.current ? new ResizeObserver(refresh) : null;
    if (stageRef.current) observer?.observe(stageRef.current);
    return () => {
      window.removeEventListener("resize", refresh);
      observer?.disconnect();
    };
  }, [requestGeometry]);

  return { geometry, requestGeometry };
}
