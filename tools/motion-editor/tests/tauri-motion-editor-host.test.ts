import { describe, expect, it, vi } from "vitest";
import type { MotionEditorProjectSnapshot } from "../src/project/manifest";
import {
  MotionEditorHostRequestError,
  TauriMotionEditorHost,
  type TauriInvoke,
} from "../src/host/TauriMotionEditorHost";

const snapshot = {
  manifest: {
    schemaVersion: 1,
    projectId: "project-1",
    displayName: "Project",
    characterRigId: "xiaoluobao",
    files: {
      artwork: "artwork.svg",
      rig: "rig.v1.json",
      motions: "motions.v1.json",
      editor: "editor.json",
    },
  },
  artwork: "<svg/>",
  rig: {
    schemaVersion: 1,
    rigId: "xiaoluobao",
    artwork: { source: "artwork.svg", fingerprint: "sha256:test", viewBox: [0, 0, 1, 1] },
    renderSlots: [],
    parts: [],
  },
  motions: { schemaVersion: 1, rigId: "xiaoluobao", clips: [] },
  editor: { schemaVersion: 1, expandedPartIds: [] },
} as MotionEditorProjectSnapshot;

describe("TauriMotionEditorHost", () => {
  it("maps snapshots and publish confirmation to narrow Tauri commands", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "prepare_production_publish") {
        return {
          planId: "plan-1",
          targetDirectory: "fixed-target",
          currentSignature: "old",
          candidateSignature: "new",
        };
      }
      return undefined;
    }) as TauriInvoke;
    const host = new TauriMotionEditorHost(invoke);

    const plan = await host.prepareProductionPublish(snapshot);
    await host.commitProductionPublish(plan.planId);

    expect(invoke).toHaveBeenNthCalledWith(1, "prepare_production_publish", { snapshot });
    expect(invoke).toHaveBeenNthCalledWith(2, "commit_production_publish", { planId: "plan-1" });
    expect(plan.targetDirectory).toBe("fixed-target");
  });

  it("preserves stable structured host errors", async () => {
    const invoke: TauriInvoke = async () => {
      throw {
        code: "path_not_authorized",
        stage: "authorize",
        path: "C:/outside",
        message: "denied",
      };
    };
    const host = new TauriMotionEditorHost(invoke);

    await expect(host.readProject("C:/outside")).rejects.toEqual(
      expect.objectContaining<Partial<MotionEditorHostRequestError>>({
        code: "path_not_authorized",
        stage: "authorize",
        path: "C:/outside",
        message: "denied",
      }),
    );
  });

  it("passes recovery and recent identifiers without general file operations", async () => {
    const invoke = vi.fn(async () => undefined);
    const host = new TauriMotionEditorHost(invoke as TauriInvoke);

    await host.removeRecentProject("C:/project");
    await host.discardRecovery("project-1");
    await host.cancelProductionPublish("plan-1");

    expect(invoke.mock.calls).toEqual([
      ["remove_recent_project", { root: "C:/project" }],
      ["discard_recovery", { projectId: "project-1" }],
      ["cancel_production_publish", { planId: "plan-1" }],
    ]);
  });
});
