import type { MotionEditorHost } from "./MotionEditorHost";
import type {
  MotionEditorHostError,
  MotionEditorProjectSnapshot,
  MotionEditorRecoverySnapshotV1,
  MotionEditorSaveResult,
  ProductionPublishPlan,
  RecentMotionEditorProjectV1,
} from "../project/manifest";

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class MotionEditorHostRequestError extends Error implements MotionEditorHostError {
  readonly code: string;
  readonly stage: string;
  readonly path?: string;

  constructor(error: MotionEditorHostError) {
    super(error.message);
    this.name = "MotionEditorHostRequestError";
    this.code = error.code;
    this.stage = error.stage;
    this.path = error.path;
  }
}

export class TauriMotionEditorHost implements MotionEditorHost {
  constructor(private readonly invoke: TauriInvoke) {}

  chooseProjectDirectory(): Promise<string | null> {
    return this.call("choose_project_directory");
  }

  chooseArtworkAndAssets(): Promise<string[] | null> {
    return this.call("choose_artwork_and_assets");
  }

  readProject(root: string): Promise<MotionEditorProjectSnapshot> {
    return this.call("read_project", { root });
  }

  saveProject(root: string, snapshot: MotionEditorProjectSnapshot): Promise<MotionEditorSaveResult> {
    return this.call("save_project", { root, snapshot });
  }

  saveProjectAs(target: string, snapshot: MotionEditorProjectSnapshot): Promise<MotionEditorSaveResult> {
    return this.call("save_project_as", { target, snapshot });
  }

  listRecentProjects(): Promise<RecentMotionEditorProjectV1[]> {
    return this.call("list_recent_projects");
  }

  removeRecentProject(root: string): Promise<void> {
    return this.call("remove_recent_project", { root });
  }

  readRecoveryCandidates(): Promise<MotionEditorRecoverySnapshotV1[]> {
    return this.call("read_recovery_candidates");
  }

  writeRecovery(recoverySnapshot: MotionEditorRecoverySnapshotV1): Promise<void> {
    return this.call("write_recovery", { recoverySnapshot });
  }

  discardRecovery(projectId: string): Promise<void> {
    return this.call("discard_recovery", { projectId });
  }

  prepareProductionPublish(snapshot: MotionEditorProjectSnapshot): Promise<ProductionPublishPlan> {
    return this.call("prepare_production_publish", { snapshot });
  }

  commitProductionPublish(planId: string): Promise<string> {
    return this.call("commit_production_publish", { planId });
  }

  cancelProductionPublish(planId: string): Promise<void> {
    return this.call("cancel_production_publish", { planId });
  }

  revealPath(path: string): Promise<void> {
    return this.call("reveal_path", { path });
  }

  private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await this.invoke<T>(command, args);
    } catch (error: unknown) {
      if (isHostError(error)) {
        throw new MotionEditorHostRequestError(error);
      }
      throw error;
    }
  }
}

export async function createTauriMotionEditorHost(): Promise<TauriMotionEditorHost> {
  const { invoke } = await import("@tauri-apps/api/core");
  return new TauriMotionEditorHost(invoke);
}

function isHostError(value: unknown): value is MotionEditorHostError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MotionEditorHostError>;
  return typeof candidate.code === "string"
    && typeof candidate.stage === "string"
    && typeof candidate.message === "string"
    && (candidate.path === undefined || typeof candidate.path === "string");
}
