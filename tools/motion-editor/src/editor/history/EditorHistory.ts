import { serializeMotionLibrary, serializeRig } from "@ltypet/character-motion";
import { applyEditorCommand } from "../model/documentCommands";
import type { EditorCommand, EditorDocument } from "../model/types";

export interface EditorHistory {
  past: EditorDocument[];
  present: EditorDocument;
  future: EditorDocument[];
  savedSignature: string;
  maxEntries: number;
}

function signature(document: EditorDocument): string {
  return `${serializeRig(document.rig)}\0${serializeMotionLibrary(document.motions)}`;
}

export function createEditorHistory(document: EditorDocument, maxEntries = 200): EditorHistory {
  return { past: [], present: document, future: [], savedSignature: signature(document), maxEntries };
}

export function executeEditorCommand(
  history: EditorHistory,
  command: EditorCommand,
): { ok: true; history: EditorHistory } | { ok: false; error: string } {
  const result = applyEditorCommand(history.present, command);
  if (!result.ok) return result;
  if (signature(result.document) === signature(history.present)) return { ok: true, history };
  return {
    ok: true,
    history: {
      ...history,
      past: [...history.past, history.present].slice(-history.maxEntries),
      present: result.document,
      future: [],
    },
  };
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    ...history,
    past: [...history.past, history.present].slice(-history.maxEntries),
    present: next,
    future: history.future.slice(1),
  };
}

export function markEditorHistorySaved(history: EditorHistory): EditorHistory {
  return { ...history, savedSignature: signature(history.present) };
}

export function isEditorHistoryDirty(history: EditorHistory): boolean {
  return signature(history.present) !== history.savedSignature;
}
