import type {
  MotionEditorProjectSnapshot,
  MotionEditorRecoverySnapshotV1,
  MotionEditorSaveResult,
  ProductionPublishPlan,
  RecentMotionEditorProjectV1,
} from "../project/manifest";

export interface MotionEditorHost {
  chooseProjectDirectory(): Promise<string | null>;
  chooseArtworkAndAssets(): Promise<string[] | null>;
  readProject(root: string): Promise<MotionEditorProjectSnapshot>;
  saveProject(root: string, snapshot: MotionEditorProjectSnapshot): Promise<MotionEditorSaveResult>;
  saveProjectAs(target: string, snapshot: MotionEditorProjectSnapshot): Promise<MotionEditorSaveResult>;
  listRecentProjects(): Promise<RecentMotionEditorProjectV1[]>;
  removeRecentProject(root: string): Promise<void>;
  readRecoveryCandidates(): Promise<MotionEditorRecoverySnapshotV1[]>;
  writeRecovery(recoverySnapshot: MotionEditorRecoverySnapshotV1): Promise<void>;
  discardRecovery(projectId: string): Promise<void>;
  prepareProductionPublish(snapshot: MotionEditorProjectSnapshot): Promise<ProductionPublishPlan>;
  commitProductionPublish(planId: string): Promise<string>;
  cancelProductionPublish(planId: string): Promise<void>;
  revealPath(path: string): Promise<void>;
}
