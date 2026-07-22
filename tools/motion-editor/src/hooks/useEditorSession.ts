import { useCallback, useState } from "react";
import type { TransformValue } from "@ltypet/character-motion";
import type {
  KeyframeClipboard,
  KeyframeRef,
  EditorCommand,
} from "../editor/model/types";
import {
  createEditorHistory,
  executeEditorCommand,
  isEditorHistoryDirty,
  undoEditorHistory,
  redoEditorHistory,
} from "../editor/history/EditorHistory";
import { reconcilePartRename } from "../editor/session/reconcilePartRename";
import type { EditorDocument } from "../editor/model/types";

export interface UseEditorSessionOptions {
  addLog: (message: string) => void;
  stopAnimation: () => void;
}

export function useEditorSession({ addLog, stopAnimation }: UseEditorSessionOptions) {
  const [history, setHistory] = useState<ReturnType<typeof createEditorHistory> | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedKeyframes, setSelectedKeyframes] = useState<KeyframeRef[]>([]);
  const [clipboard, setClipboard] = useState<KeyframeClipboard | null>(null);
  const [hiddenPartIds, setHiddenPartIds] = useState<Set<string>>(new Set());
  const [lockedPartIds, setLockedPartIds] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<"select" | "pivot">("select");
  const [transformDraft, setTransformDraft] = useState<{ partId: string; value: TransformValue } | null>(null);
  const [pivotDraft, setPivotDraft] = useState<{ partId: string; x: number; y: number } | null>(null);

  const documentState: EditorDocument | null = history?.present ?? null;
  const rig = documentState?.rig ?? null;
  const motionLibrary = documentState?.motions ?? null;
  const activeClip = motionLibrary?.clips.find((clip) => clip.id === activeClipId) ?? null;
  const dirty = history ? isEditorHistoryDirty(history) : false;

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

  const renamePart = useCallback((nextPartId: string) => {
    if (!selectedPartId || !runCommand({ type: "rig.renamePart", partId: selectedPartId, nextPartId })) return;
    const reconciled = reconcilePartRename({
      selectedPartId,
      hiddenPartIds,
      lockedPartIds,
      selectedKeyframes,
      clipboard,
    }, selectedPartId, nextPartId);
    setSelectedPartId(reconciled.selectedPartId);
    setHiddenPartIds(reconciled.hiddenPartIds);
    setLockedPartIds(reconciled.lockedPartIds);
    setSelectedKeyframes(reconciled.selectedKeyframes);
    setClipboard(reconciled.clipboard);
  }, [selectedPartId, runCommand, hiddenPartIds, lockedPartIds, selectedKeyframes, clipboard]);

  const toggleHiddenPart = useCallback((partId: string) => {
    setHiddenPartIds((current) => {
      const next = new Set(current);
      if (next.has(partId)) next.delete(partId); else next.add(partId);
      return next;
    });
  }, []);

  const toggleLockedPart = useCallback((partId: string) => {
    setLockedPartIds((current) => {
      const next = new Set(current);
      if (next.has(partId)) next.delete(partId); else next.add(partId);
      return next;
    });
  }, []);

  return {
    // State
    history, setHistory,
    activeClipId, setActiveClipId,
    selectedPartId, setSelectedPartId,
    selectedKeyframes, setSelectedKeyframes,
    clipboard, setClipboard,
    hiddenPartIds, setHiddenPartIds,
    lockedPartIds, setLockedPartIds,
    tool, setTool,
    transformDraft, setTransformDraft,
    pivotDraft, setPivotDraft,
    // Derived
    documentState, rig, motionLibrary, activeClip, dirty,
    // Actions
    runCommand, undo, redo, renamePart, toggleHiddenPart, toggleLockedPart,
  };
}


