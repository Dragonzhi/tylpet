import { useEffect } from "react";

export interface UseKeyboardShortcutsActions {
  activeClipDuration: number | undefined;
  insertCurrentKeyframe: () => void;
  deleteCurrentKeyframe: () => void;
  undo: () => void;
  redo: () => void;
  copySelected: () => void;
  pasteSelected: () => void;
  deleteSelected: () => void;
  togglePlay: () => void;
  stopAnimation: () => void;
  setCurrentFrame: (frame: number | ((prev: number) => number)) => void;
  moveSelectedKeyframes: (deltaFrames: number) => void;
  hasSelectedKeyframes: boolean;
  cancelDrafts: () => void;
}

export function useKeyboardShortcuts(actions: UseKeyboardShortcutsActions) {
  const {
    activeClipDuration, insertCurrentKeyframe, deleteCurrentKeyframe,
    undo, redo, copySelected, pasteSelected, deleteSelected,
    togglePlay, stopAnimation, setCurrentFrame, moveSelectedKeyframes,
    hasSelectedKeyframes, cancelDrafts,
  } = actions;

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
        setCurrentFrame((frame) => Math.min(activeClipDuration ?? 0, frame + 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        stopAnimation();
        setCurrentFrame(0);
      } else if (event.key === "End") {
        event.preventDefault();
        stopAnimation();
        setCurrentFrame(activeClipDuration ?? 0);
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && hasSelectedKeyframes) {
        event.preventDefault();
        moveSelectedKeyframes((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1));
      } else if (event.key === "Escape") {
        cancelDrafts();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    activeClipDuration, insertCurrentKeyframe, deleteCurrentKeyframe,
    undo, redo, copySelected, pasteSelected, deleteSelected,
    togglePlay, stopAnimation, setCurrentFrame, moveSelectedKeyframes,
    hasSelectedKeyframes, cancelDrafts,
  ]);
}
