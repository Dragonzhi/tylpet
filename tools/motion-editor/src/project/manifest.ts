import type { CharacterRigV1, MotionLibraryV1 } from "@ltypet/character-motion";

export interface MotionEditorProjectManifestV1 {
  schemaVersion: 1;
  projectId: string;
  displayName: string;
  characterRigId: string;
  files: {
    artwork: string;
    rig: string;
    motions: string;
    editor: string;
  };
}

export interface MotionEditorStateV1 {
  schemaVersion: 1;
  activeClipId?: string;
  timelineScale?: number;
  expandedPartIds: string[];
}

export interface MotionEditorProjectSnapshot {
  manifest: MotionEditorProjectManifestV1;
  artwork: string;
  rig: CharacterRigV1;
  motions: MotionLibraryV1;
  editor: MotionEditorStateV1;
}

export interface MotionEditorRecoveryMetadataV1 {
  schemaVersion: 1;
  projectId: string;
  sourcePathHash: string;
  savedSignature: string;
  createdAtUnixMs: number;
  documentSignature: string;
}

export interface MotionEditorRecoverySnapshotV1 {
  metadata: MotionEditorRecoveryMetadataV1;
  snapshot: MotionEditorProjectSnapshot;
}

export interface RecentMotionEditorProjectV1 {
  schemaVersion: 1;
  projectId: string;
  displayName: string;
  root: string;
  openedAtUnixMs: number;
}

export interface MotionEditorSaveResult {
  root: string;
  signature: string;
}

export interface ProductionPublishPlan {
  planId: string;
  targetDirectory: string;
  currentSignature: string;
  candidateSignature: string;
}

export interface MotionEditorHostError {
  code: string;
  stage: string;
  path?: string;
  message: string;
}
