import type { KeyframeClipboard, KeyframeRef } from "../model/types";

export interface PartReferenceSession {
  selectedPartId: string | null;
  hiddenPartIds: Set<string>;
  lockedPartIds: Set<string>;
  selectedKeyframes: KeyframeRef[];
  clipboard: KeyframeClipboard | null;
}

function renamePartId(partId: string, previousPartId: string, nextPartId: string): string {
  return partId === previousPartId ? nextPartId : partId;
}

function renamePartIdSet(
  partIds: Set<string>,
  previousPartId: string,
  nextPartId: string,
): Set<string> {
  if (!partIds.has(previousPartId)) return partIds;
  const next = new Set(partIds);
  next.delete(previousPartId);
  next.add(nextPartId);
  return next;
}

export function reconcilePartRename(
  session: PartReferenceSession,
  previousPartId: string,
  nextPartId: string,
): PartReferenceSession {
  if (previousPartId === nextPartId) return session;
  return {
    selectedPartId: session.selectedPartId === null
      ? null
      : renamePartId(session.selectedPartId, previousPartId, nextPartId),
    hiddenPartIds: renamePartIdSet(session.hiddenPartIds, previousPartId, nextPartId),
    lockedPartIds: renamePartIdSet(session.lockedPartIds, previousPartId, nextPartId),
    selectedKeyframes: session.selectedKeyframes.map((ref) => ({
      ...ref,
      partId: renamePartId(ref.partId, previousPartId, nextPartId),
    })),
    clipboard: session.clipboard === null
      ? null
      : {
          ...session.clipboard,
          entries: session.clipboard.entries.map((entry) => ({
            ...entry,
            partId: renamePartId(entry.partId, previousPartId, nextPartId),
          })),
        },
  };
}
