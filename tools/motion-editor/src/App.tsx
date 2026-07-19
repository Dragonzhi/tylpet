import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EasingValue,
  MotionClipV1,
  MotionKeyframeV1,
  MotionLibraryV1,
  ProceduralChannel,
  TransformValue,
} from "@ltypet/character-motion";
import {
  sampleMotionClip,
  serializeMotionLibrary,
  serializeRig,
  sha256CanonicalText,
  validateMotionLibrary,
} from "@ltypet/character-motion";
import rawGlaxSvg from "../../../src/assets/小洛宝.glax.svg?raw";
import { PartTree } from "./components/parts/PartTree";
import { TransformInspector } from "./components/inspector/TransformInspector";
import { TransformGizmo } from "./components/stage/TransformGizmo";
import { Timeline } from "./components/timeline/Timeline";
import {
  createEditorHistory,
  executeEditorCommand,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  redoEditorHistory,
  undoEditorHistory,
} from "./editor/history/EditorHistory";
import { createKeyframeClipboard } from "./editor/model/documentCommands";
import type {
  EditorCommand,
  KeyframeClipboard,
  KeyframeRef,
} from "./editor/model/types";
import type { Diagnostic, ImportResult, PartScreenGeometry } from "./svgcanvas/SvgCanvasAdapter";
import { SvgCanvasAdapter } from "./svgcanvas/SvgCanvasAdapter";
import {
  buildRigFromImport,
  createWaveExample,
  parseMotionLibraryForRig,
  parseRigForArtwork,
} from "./project/v1Project";

const SAMPLE_ARTWORK_NAME = "小洛宝.glax.svg";
const DEFAULT_TRANSFORM: TransformValue = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
};

const PROCEDURAL_CHANNELS: ProceduralChannel[] = [
  "breathing",
  "blinking",
  "pointer-follow",
  "hair-physics",
  "ear-twitch",
];

function downloadText(name: string, text: string) {
  const anchor = document.createElement("a");
  // A data URL keeps the export self-contained. Revoking a blob URL after
  // click() proved racy in Chromium/headless and could silently cancel files.
  anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function cloneClip(clip: MotionClipV1, id: string): MotionClipV1 {
  return {
    ...clip,
    id,
    tracks: clip.tracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.map((keyframe) => ({
        ...keyframe,
        values: { ...keyframe.values },
        ...(typeof keyframe.easing === "object"
          ? { easing: { cubicBezier: [...keyframe.easing.cubicBezier] as [number, number, number, number] } }
          : {}),
      })),
    })),
    events: clip.events.map((event) => ({ ...event, ...(event.payload ? { payload: { ...event.payload } } : {}) })),
    ...(clip.suppressProceduralChannels
      ? { suppressProceduralChannels: [...clip.suppressProceduralChannels] }
      : {}),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const stageRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<SvgCanvasAdapter | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimestampRef = useRef(0);
  const elapsedFramesRef = useRef(0);
  const animatedPartsRef = useRef<Set<string>>(new Set());
  const motionInputRef = useRef<HTMLInputElement>(null);
  const rigInputRef = useRef<HTMLInputElement>(null);
  const spacePressedRef = useRef(false);
  const panGestureRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);

  const [fingerprint, setFingerprint] = useState("");
  const [canvasVersion, setCanvasVersion] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [history, setHistory] = useState<ReturnType<typeof createEditorHistory> | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedKeyframes, setSelectedKeyframes] = useState<KeyframeRef[]>([]);
  const [clipboard, setClipboard] = useState<KeyframeClipboard | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [pixelsPerFrame, setPixelsPerFrame] = useState(8);
  const [hiddenPartIds, setHiddenPartIds] = useState<Set<string>>(new Set());
  const [lockedPartIds, setLockedPartIds] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<"select" | "pivot">("select");
  const [isPlaying, setIsPlaying] = useState(false);
  const [geometry, setGeometry] = useState<PartScreenGeometry | null>(null);
  const [transformDraft, setTransformDraft] = useState<{ partId: string; value: TransformValue } | null>(null);
  const [pivotDraft, setPivotDraft] = useState<{ partId: string; x: number; y: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [stagePan, setStagePan] = useState({ x: 0, y: 0 });

  const documentState = history?.present ?? null;
  const rig = documentState?.rig ?? null;
  const motionLibrary = documentState?.motions ?? null;
  const activeClip = motionLibrary?.clips.find((clip) => clip.id === activeClipId) ?? null;
  const dirty = history ? isEditorHistoryDirty(history) : false;

  const addLog = useCallback((message: string) => {
    setLog((previous) => [...previous.slice(-149), message]);
  }, []);

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    lastTimestampRef.current = 0;
    setIsPlaying(false);
  }, []);

  const requestGeometry = useCallback(() => {
    const adapter = adapterRef.current;
    const stage = stageRef.current;
    if (!adapter || !stage || !selectedPartId) {
      setGeometry(null);
      return;
    }
    requestAnimationFrame(() => setGeometry(adapter.getPartScreenGeometry(selectedPartId, stage)));
  }, [selectedPartId]);

  const selectPart = useCallback((partId: string) => {
    setSelectedPartId(partId);
    setSelectedKeyframes([]);
    adapterRef.current?.selectPart(partId);
    requestAnimationFrame(requestGeometry);
  }, [requestGeometry]);

  const runCommand = useCallback((command: EditorCommand): boolean => {
    if (!history) return false;
    const result = executeEditorCommand(history, command);
    if (!result.ok) {
      addLog(`[错误] ${result.error}`);
      return false;
    }
    setHistory(result.history);
    return true;
  }, [addLog, history]);

  useEffect(() => {
    let cancelled = false;
    void sha256CanonicalText(rawGlaxSvg).then((value) => {
      if (!cancelled) setFingerprint(value);
    }).catch((error: unknown) => addLog(`[错误] 素材指纹计算失败：${formatError(error)}`));
    return () => { cancelled = true; };
  }, [addLog]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) {
        spacePressedRef.current = true;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = false;
    };
    const blur = () => { spacePressedRef.current = false; panGestureRef.current = null; };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const handleInit = () => {
    if (!containerRef.current || adapterRef.current) return;
    try {
      const adapter = new SvgCanvasAdapter();
      adapter.mount(containerRef.current);
      adapter.onPartSelected((partId) => {
        setSelectedPartId(partId);
        setSelectedKeyframes([]);
      });
      adapterRef.current = adapter;
      setCanvasVersion(adapter.getVersion());
      addLog(`[信息] svgcanvas v${adapter.getVersion()} 初始化完成`);
    } catch (error: unknown) {
      addLog(`[错误] 画布初始化失败：${formatError(error)}`);
    }
  };

  const mayReplaceProject = () => !dirty || window.confirm("当前项目有未导出的修改，确定替换吗？");

  const handleLoadCharacter = () => {
    const adapter = adapterRef.current;
    if (!adapter || !fingerprint || !mayReplaceProject()) return;
    try {
      stopAnimation();
      const imported = adapter.loadSvg(rawGlaxSvg);
      setDiagnostics(imported.diagnostics);
      if (imported.diagnostics.some((item) => item.severity === "error")) {
        throw new Error("素材导入存在 error，未建立 rig");
      }
      const nextRig = buildRigFromImport(imported, { source: SAMPLE_ARTWORK_NAME, fingerprint });
      const motions: MotionLibraryV1 = { schemaVersion: 1, rigId: nextRig.rigId, clips: [] };
      setImportResult(imported);
      setHistory(createEditorHistory({ rig: nextRig, motions }));
      setActiveClipId(null);
      setCurrentFrame(0);
      setHiddenPartIds(new Set());
      setLockedPartIds(new Set());
      setStagePan({ x: 0, y: 0 });
      const firstPart = nextRig.parts[0]?.id ?? null;
      setSelectedPartId(firstPart);
      if (firstPart) adapter.selectPart(firstPart);
      adapter.onPartSelected((partId) => {
        setSelectedPartId(partId);
        setSelectedKeyframes([]);
      });
      addLog(`[信息] 角色已载入：${nextRig.parts.length} 个 Part，${imported.pivotLocal.size} 个 pivot`);
    } catch (error: unknown) {
      addLog(`[错误] 载入角色失败：${formatError(error)}`);
    }
  };

  const handleLoadWaveExample = () => {
    if (!rig || !history) return;
    const wave = createWaveExample(rig).clips[0];
    if (runCommand({ type: "clip.add", clip: wave })) {
      setActiveClipId(wave.id);
      setCurrentFrame(0);
      selectPart("arm_right");
    }
  };

  useEffect(() => {
    if (!activeClip) {
      stopAnimation();
      setCurrentFrame(0);
      return;
    }
    if (currentFrame > activeClip.durationFrames) setCurrentFrame(activeClip.durationFrames);
  }, [activeClip, currentFrame, stopAnimation]);

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

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !rig) return;
    for (const part of rig.parts) {
      adapter.setPartVisible(part.id, !hiddenPartIds.has(part.id));
      adapter.setPartLocked(part.id, lockedPartIds.has(part.id));
    }
    requestGeometry();
  }, [hiddenPartIds, lockedPartIds, requestGeometry, rig]);

  useEffect(() => {
    requestGeometry();
  }, [requestGeometry, stagePan]);

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

  useEffect(() => {
    if (!isPlaying || !activeClip) return;
    const frameDuration = 1000 / activeClip.fps;
    const animate = (timestamp: number) => {
      if (lastTimestampRef.current === 0) lastTimestampRef.current = timestamp;
      elapsedFramesRef.current += (timestamp - lastTimestampRef.current) / frameDuration;
      lastTimestampRef.current = timestamp;
      let frame = Math.floor(elapsedFramesRef.current);
      if (frame > activeClip.durationFrames) {
        if (activeClip.loop === "repeat") {
          elapsedFramesRef.current %= activeClip.durationFrames + 1;
          frame = Math.floor(elapsedFramesRef.current);
        } else {
          setCurrentFrame(activeClip.durationFrames);
          setIsPlaying(false);
          animationRef.current = null;
          return;
        }
      }
      setCurrentFrame(frame);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [activeClip, isPlaying]);

  const togglePlay = useCallback(() => {
    if (!activeClip) return;
    if (isPlaying) {
      stopAnimation();
      return;
    }
    elapsedFramesRef.current = currentFrame;
    lastTimestampRef.current = 0;
    setIsPlaying(true);
  }, [activeClip, currentFrame, isPlaying, stopAnimation]);

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
  }, [activeClip, currentFrame, exactKeyframe, runCommand, selectedPartId]);

  const updateCurrentValues = (values: Partial<MotionKeyframeV1["values"]>) => {
    if (!activeClip || !selectedPartId || !exactKeyframe) return;
    runCommand({
      type: "keyframe.upsert",
      clipId: activeClip.id,
      partId: selectedPartId,
      keyframe: { frame: currentFrame, values, ...(exactKeyframe.easing ? { easing: exactKeyframe.easing } : {}) },
      merge: true,
    });
  };

  const updateCurrentEasing = (easing: EasingValue) => {
    if (!activeClip || !selectedPartId || !exactKeyframe) return;
    runCommand({
      type: "keyframe.upsert",
      clipId: activeClip.id,
      partId: selectedPartId,
      keyframe: { frame: currentFrame, values: exactKeyframe.values, easing },
      merge: true,
    });
  };

  const commitTransform = (value: TransformValue) => {
    setTransformDraft(null);
    updateCurrentValues(value);
  };

  const commitPivot = (x: number, y: number) => {
    if (!selectedPartId) return;
    setPivotDraft(null);
    runCommand({ type: "rig.updatePivot", partId: selectedPartId, x, y });
  };

  const selectKeyframe = (ref: KeyframeRef, modifiers: { toggle: boolean; range: boolean }) => {
    selectPart(ref.partId);
    setCurrentFrame(ref.frame);
    setSelectedKeyframes((previous) => {
      const key = (candidate: KeyframeRef) => `${candidate.clipId}\0${candidate.partId}\0${candidate.frame}`;
      if (modifiers.range) {
        const anchor = [...previous].reverse().find((candidate) => candidate.clipId === ref.clipId && candidate.partId === ref.partId);
        const track = activeClip?.tracks.find((candidate) => candidate.partId === ref.partId);
        if (anchor && track) {
          const min = Math.min(anchor.frame, ref.frame);
          const max = Math.max(anchor.frame, ref.frame);
          return track.keyframes.filter((keyframe) => keyframe.frame >= min && keyframe.frame <= max)
            .map((keyframe) => ({ clipId: ref.clipId, partId: ref.partId, frame: keyframe.frame }));
        }
      }
      if (modifiers.toggle) {
        return previous.some((candidate) => key(candidate) === key(ref))
          ? previous.filter((candidate) => key(candidate) !== key(ref))
          : [...previous, ref];
      }
      return [ref];
    });
  };

  const moveKeyframes = (refs: KeyframeRef[], deltaFrames: number) => {
    if (runCommand({ type: "keyframe.moveMany", refs, deltaFrames })) {
      setSelectedKeyframes(refs.map((ref) => ({ ...ref, frame: ref.frame + deltaFrames })));
      if (refs.some((ref) => ref.partId === selectedPartId && ref.frame === currentFrame)) {
        setCurrentFrame((frame) => frame + deltaFrames);
      }
    }
  };

  const copySelected = useCallback(() => {
    if (!history) return;
    const result = createKeyframeClipboard(history.present, selectedKeyframes);
    if (!result.ok) addLog(`[错误] ${result.error}`);
    else {
      setClipboard(result.value);
      addLog(`[信息] 已复制 ${result.value.entries.length} 个关键帧`);
    }
  }, [addLog, history, selectedKeyframes]);

  const pasteSelected = useCallback(() => {
    if (!activeClip || !clipboard) return;
    runCommand({ type: "keyframe.paste", clipId: activeClip.id, targetFrame: currentFrame, clipboard });
  }, [activeClip, clipboard, currentFrame, runCommand]);

  const deleteSelected = useCallback(() => {
    if (selectedKeyframes.length === 0) return;
    if (runCommand({ type: "keyframe.deleteMany", refs: selectedKeyframes })) setSelectedKeyframes([]);
  }, [runCommand, selectedKeyframes]);

  const undo = useCallback(() => {
    stopAnimation();
    setTransformDraft(null);
    setPivotDraft(null);
    setHistory((current) => current ? undoEditorHistory(current) : current);
  }, [stopAnimation]);

  const redo = useCallback(() => {
    stopAnimation();
    setTransformDraft(null);
    setPivotDraft(null);
    setHistory((current) => current ? redoEditorHistory(current) : current);
  }, [stopAnimation]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      const editingText = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
      if (editingText && event.key !== "Escape") return;
      const command = event.ctrlKey || event.metaKey;
      if (event.key === "F6") {
        event.preventDefault();
        if (event.shiftKey) deleteCurrentKeyframe(); else insertCurrentKeyframe();
      } else if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (command && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelected();
      } else if (command && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteSelected();
      } else if (event.key === "Delete") {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === "Enter") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === ",") {
        event.preventDefault();
        stopAnimation();
        setCurrentFrame((frame) => Math.max(0, frame - 1));
      } else if (event.key === ".") {
        event.preventDefault();
        stopAnimation();
        setCurrentFrame((frame) => Math.min(activeClip?.durationFrames ?? 0, frame + 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        stopAnimation();
        setCurrentFrame(0);
      } else if (event.key === "End") {
        event.preventDefault();
        stopAnimation();
        setCurrentFrame(activeClip?.durationFrames ?? 0);
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && selectedKeyframes.length > 0) {
        event.preventDefault();
        moveKeyframes(selectedKeyframes, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1));
      } else if (event.key === "Escape") {
        setTransformDraft(null);
        setPivotDraft(null);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [activeClip?.durationFrames, copySelected, deleteCurrentKeyframe, deleteSelected, insertCurrentKeyframe, pasteSelected, redo, selectedKeyframes, stopAnimation, togglePlay, undo]);

  const addClip = () => {
    if (!history) return;
    const id = window.prompt("新动作 ID（小写字母、数字、_、-）", "idle")?.trim();
    if (!id) return;
    const clip: MotionClipV1 = { id, fps: 24, durationFrames: 48, loop: "none", tracks: [], events: [] };
    if (runCommand({ type: "clip.add", clip })) {
      setActiveClipId(id);
      setCurrentFrame(0);
    }
  };

  const duplicateClip = () => {
    if (!activeClip) return;
    const id = window.prompt("复制后的动作 ID", `${activeClip.id}_copy`)?.trim();
    if (!id) return;
    if (runCommand({ type: "clip.add", clip: cloneClip(activeClip, id) })) setActiveClipId(id);
  };

  const renameClip = () => {
    if (!activeClip) return;
    const id = window.prompt("新的动作 ID", activeClip.id)?.trim();
    if (!id || id === activeClip.id) return;
    if (runCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { id } })) setActiveClipId(id);
  };

  const deleteClip = () => {
    if (!activeClip || !window.confirm(`删除动作 ${activeClip.id}？`)) return;
    const next = motionLibrary?.clips.find((clip) => clip.id !== activeClip.id)?.id ?? null;
    if (runCommand({ type: "clip.delete", clipId: activeClip.id })) {
      setActiveClipId(next);
      setCurrentFrame(0);
    }
  };

  const importTextFile = (
    event: React.ChangeEvent<HTMLInputElement>,
    handler: (text: string, name: string) => void,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? handler(reader.result, file.name)
      : addLog(`[错误] 无法读取 ${file.name}`);
    reader.onerror = () => addLog(`[错误] 读取 ${file.name} 失败`);
    reader.readAsText(file);
  };

  const importRig = (text: string, name: string) => {
    if (!history || !importResult || !fingerprint || !mayReplaceProject()) return;
    try {
      const nextRig = parseRigForArtwork(text, importResult, { source: SAMPLE_ARTWORK_NAME, fingerprint });
      const validation = validateMotionLibrary(history.present.motions, nextRig);
      const motions = validation.ok
        ? validation.value
        : { schemaVersion: 1 as const, rigId: nextRig.rigId, clips: [] };
      setHistory(createEditorHistory({ rig: nextRig, motions }));
      setActiveClipId(motions.clips[0]?.id ?? null);
      addLog(`[信息] 已导入 Rig：${name}`);
    } catch (error: unknown) {
      addLog(`[错误] Rig 导入失败：${formatError(error)}`);
    }
  };

  const importMotions = (text: string, name: string) => {
    if (!rig || !history || !mayReplaceProject()) return;
    try {
      const motions = parseMotionLibraryForRig(text, rig);
      setHistory(createEditorHistory({ rig, motions }));
      const first = motions.clips[0] ?? null;
      setActiveClipId(first?.id ?? null);
      setCurrentFrame(0);
      if (first?.tracks[0]) selectPart(first.tracks[0].partId);
      addLog(`[信息] 已导入动作库 ${name}：${motions.clips.length} 个 Clip`);
    } catch (error: unknown) {
      addLog(`[错误] 动作导入失败：${formatError(error)}`);
    }
  };

  const exportProject = () => {
    if (!history) return;
    downloadText(`${history.present.rig.rigId}.rig.v1.json`, serializeRig(history.present.rig));
    downloadText(`${history.present.rig.rigId}.motions.v1.json`, serializeMotionLibrary(history.present.motions));
    setHistory(markEditorHistorySaved(history));
    addLog(`[信息] 已导出 rig 和 motions：${history.present.motions.clips.length} 个 Clip`);
  };

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    adapterRef.current?.dispose();
  }, []);

  return (
    <div className="app p2-editor">
      <header className="toolbar">
        <h1>小洛宝 Animation Studio — P2</h1>
        <div className="controls">
          <button type="button" onClick={handleInit} disabled={!!adapterRef.current}>1. 初始化画布</button>
          <button type="button" onClick={handleLoadCharacter} disabled={!adapterRef.current || !fingerprint}>2. 载入角色</button>
          <button type="button" onClick={() => rigInputRef.current?.click()} disabled={!rig}>导入 Rig</button>
          <button type="button" onClick={() => motionInputRef.current?.click()} disabled={!rig}>导入动作</button>
          <button type="button" onClick={exportProject} disabled={!history}>导出项目</button>
          <button type="button" onClick={undo} disabled={!history?.past.length} aria-label="撤销">↶</button>
          <button type="button" onClick={redo} disabled={!history?.future.length} aria-label="重做">↷</button>
          <input ref={rigInputRef} type="file" accept=".json" hidden onChange={(event) => importTextFile(event, importRig)} />
          <input ref={motionInputRef} type="file" accept=".json" hidden onChange={(event) => importTextFile(event, importMotions)} />
        </div>
        <span className={`dirty-indicator ${dirty ? "dirty" : ""}`}>{dirty ? "● 未导出" : "✓ 已保存"}</span>
        {canvasVersion && <span className="version">svgcanvas v{canvasVersion}</span>}
      </header>

      <aside className="left-sidebar">
        {rig ? (
          <PartTree
            rig={rig}
            selectedPartId={selectedPartId}
            hiddenPartIds={hiddenPartIds}
            lockedPartIds={lockedPartIds}
            onSelect={selectPart}
            onToggleHidden={(partId) => setHiddenPartIds((current) => {
              const next = new Set(current);
              if (next.has(partId)) next.delete(partId); else next.add(partId);
              return next;
            })}
            onToggleLocked={(partId) => setLockedPartIds((current) => {
              const next = new Set(current);
              if (next.has(partId)) next.delete(partId); else next.add(partId);
              return next;
            })}
          />
        ) : <p className="placeholder panel">请先初始化并载入角色</p>}
        <section className="panel clip-panel">
          <h2>Motion Clips</h2>
          <div className="clip-actions">
            <button type="button" onClick={addClip} disabled={!history}>＋新建</button>
            <button type="button" onClick={duplicateClip} disabled={!activeClip}>复制</button>
            <button type="button" onClick={renameClip} disabled={!activeClip}>改名</button>
            <button type="button" onClick={deleteClip} disabled={!activeClip}>删除</button>
          </div>
          <button type="button" onClick={handleLoadWaveExample} disabled={!rig || !!motionLibrary?.clips.some((clip) => clip.id === "p0-wave")}>载入 P1 挥手参考</button>
          <ul className="clip-list">
            {motionLibrary?.clips.map((clip) => (
              <li key={clip.id}>
                <button
                  type="button"
                  className={clip.id === activeClipId ? "selected" : ""}
                  onClick={() => {
                    stopAnimation();
                    setActiveClipId(clip.id);
                    setCurrentFrame(0);
                    setSelectedKeyframes([]);
                  }}
                >
                  {clip.id}<span>{clip.durationFrames}f</span>
                </button>
              </li>
            ))}
          </ul>
          {activeClip && (
            <div className="clip-meta">
              <label>FPS <input type="number" min="1" max="60" value={activeClip.fps} onChange={(event) => runCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { fps: Number(event.target.value) } })} /></label>
              <label>末帧 <input type="number" min="1" value={activeClip.durationFrames} onChange={(event) => runCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { durationFrames: Number(event.target.value) } })} /></label>
              <label>循环 <select value={activeClip.loop} onChange={(event) => runCommand({ type: "clip.updateMeta", clipId: activeClip.id, patch: { loop: event.target.value as MotionClipV1["loop"] } })}><option value="none">none</option><option value="repeat">repeat</option></select></label>
            </div>
          )}
          {activeClip && (
            <fieldset className="procedural-channels">
              <legend>暂停程序动画</legend>
              {PROCEDURAL_CHANNELS.map((channel) => (
                <label key={channel}>
                  <input
                    type="checkbox"
                    checked={activeClip.suppressProceduralChannels?.includes(channel) ?? false}
                    onChange={(event) => {
                      const current = activeClip.suppressProceduralChannels ?? [];
                      const next = event.target.checked
                        ? [...current, channel]
                        : current.filter((candidate) => candidate !== channel);
                      runCommand({
                        type: "clip.updateMeta",
                        clipId: activeClip.id,
                        patch: { suppressProceduralChannels: next },
                      });
                    }}
                  />
                  {channel}
                </label>
              ))}
            </fieldset>
          )}
        </section>
      </aside>

      <main
        className="stage-area"
        ref={stageRef}
        onPointerDownCapture={(event) => {
          if (!spacePressedRef.current || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          panGestureRef.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            x: stagePan.x,
            y: stagePan.y,
          };
        }}
        onPointerMoveCapture={(event) => {
          const gesture = panGestureRef.current;
          if (!gesture || gesture.pointerId !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          setStagePan({
            x: gesture.x + event.clientX - gesture.clientX,
            y: gesture.y + event.clientY - gesture.clientY,
          });
        }}
        onPointerUpCapture={(event) => {
          if (panGestureRef.current?.pointerId === event.pointerId) panGestureRef.current = null;
        }}
        onPointerCancelCapture={() => { panGestureRef.current = null; }}
      >
        <div className="stage-tools">
          <button type="button" className={tool === "select" ? "selected" : ""} onClick={() => setTool("select")}>选择/变换</button>
          <button type="button" className={tool === "pivot" ? "selected" : ""} onClick={() => setTool("pivot")}>Pivot 工具</button>
          <button type="button" onClick={insertCurrentKeyframe} disabled={!activeClip || !selectedPartId}>F6 打帧</button>
          <button type="button" onClick={deleteCurrentKeyframe} disabled={!exactKeyframe}>Shift+F6 删除</button>
        </div>
        <div
          ref={containerRef}
          className="canvas-container"
          style={{ transform: `translate(${stagePan.x}px, ${stagePan.y}px)` }}
        />
        <TransformGizmo
          geometry={geometry}
          partId={selectedPartId}
          transform={displayedTransform}
          pivot={displayedPivot}
          hasKeyframe={!!exactKeyframe}
          locked={selectedPartId ? lockedPartIds.has(selectedPartId) : false}
          tool={tool}
          stageElement={stageRef.current}
          adapter={adapterRef.current}
          onTransformPreview={(value) => selectedPartId && setTransformDraft({ partId: selectedPartId, value })}
          onTransformCommit={commitTransform}
          onPivotPreview={(x, y) => selectedPartId && setPivotDraft({ partId: selectedPartId, x, y })}
          onPivotCommit={commitPivot}
          onCancel={() => { setTransformDraft(null); setPivotDraft(null); }}
          onNeedsKeyframe={() => addLog("[提示] 当前帧尚无关键帧，请先按 F6")}
        />
      </main>

      <aside className="right-sidebar">
        {rig && (
          <TransformInspector
            rig={rig}
            partId={selectedPartId}
            frame={currentFrame}
            sampled={displayedTransform}
            keyframe={exactKeyframe}
            onInsert={insertCurrentKeyframe}
            onUpdateValues={updateCurrentValues}
            onRemoveRenderSlot={() => {
              if (!activeClip || !selectedPartId || !exactKeyframe?.values.renderSlot) return;
              runCommand({
                type: "keyframe.removeValues",
                clipId: activeClip.id,
                partId: selectedPartId,
                frame: currentFrame,
                properties: ["renderSlot"],
              });
            }}
            onUpdateEasing={updateCurrentEasing}
            onUpdatePivot={commitPivot}
          />
        )}
        <section className="panel diagnostics-section">
          <h2>诊断</h2>
          <p>{importResult ? `${importResult.parts.length} Part · ${importResult.pivotLocal.size} pivot` : "尚未载入"}</p>
          <ul>{diagnostics.filter((item) => item.severity !== "info").map((item, index) => <li key={`${item.message}-${index}`} className={`diag-${item.severity}`}>{item.message}</li>)}</ul>
        </section>
        <section className="panel log-section">
          <h2>日志</h2>
          <pre className="log">{log.join("\n") || "等待操作…"}</pre>
        </section>
      </aside>

      <footer className="bottom-editor">
        {activeClip ? (
          <>
            <div className="playback-bar">
              <button type="button" onClick={() => setCurrentFrame(0)} aria-label="首帧">⏮</button>
              <button type="button" onClick={() => setCurrentFrame((frame) => Math.max(0, frame - 1))} aria-label="前一帧">◀</button>
              <button type="button" onClick={togglePlay}>{isPlaying ? "⏸ 暂停" : "▶ 播放"}</button>
              <button type="button" onClick={() => setCurrentFrame((frame) => Math.min(activeClip.durationFrames, frame + 1))} aria-label="后一帧">▶</button>
              <button type="button" onClick={() => setCurrentFrame(activeClip.durationFrames)} aria-label="末帧">⏭</button>
              <span>{currentFrame}/{activeClip.durationFrames}</span>
              <button type="button" onClick={copySelected} disabled={!selectedKeyframes.length}>复制帧</button>
              <button type="button" onClick={pasteSelected} disabled={!clipboard}>粘贴帧</button>
              <button type="button" onClick={deleteSelected} disabled={!selectedKeyframes.length}>删除帧</button>
            </div>
            <Timeline
              clip={activeClip}
              selectedPartId={selectedPartId}
              currentFrame={currentFrame}
              pixelsPerFrame={pixelsPerFrame}
              selectedKeyframes={selectedKeyframes}
              onFrameChange={(frame) => { stopAnimation(); setCurrentFrame(frame); }}
              onPixelsPerFrameChange={setPixelsPerFrame}
              onSelectKeyframe={selectKeyframe}
              onMoveKeyframes={moveKeyframes}
            />
          </>
        ) : <div className="empty-timeline">新建或导入 Motion Clip 后开始制作动作</div>}
      </footer>
    </div>
  );
}
