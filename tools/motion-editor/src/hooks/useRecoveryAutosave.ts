import { useEffect } from "react";
import type { MotionEditorHost } from "../host/MotionEditorHost";
import type { MotionEditorProjectSnapshot } from "../project/manifest";
import { sha256Text, projectDocumentText } from "../lib/projectText";
import { formatError } from "../lib/errors";

const RECOVERY_DEBOUNCE_MS = 800;

export function useRecoveryAutosave({
  host, dirty, createSnapshot, projectRoot, savedHostSignature, addLog,
}: {
  host: MotionEditorHost | null;
  dirty: boolean;
  createSnapshot: () => MotionEditorProjectSnapshot | null;
  projectRoot: string | null;
  savedHostSignature: string;
  addLog: (message: string) => void;
}) {
  useEffect(() => {
    if (!host || !dirty) return;
    const snapshot = createSnapshot();
    if (!snapshot) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void Promise.all([
        sha256Text(projectDocumentText(snapshot)),
        sha256Text(projectRoot ?? snapshot.manifest.projectId),
      ]).then(([documentSignature, sourcePathHash]) => host.writeRecovery({
        metadata: {
          schemaVersion: 1,
          projectId: snapshot.manifest.projectId,
          sourcePathHash,
          savedSignature: savedHostSignature || "sha256:unsaved",
          createdAtUnixMs: Date.now(),
          documentSignature,
        },
        snapshot,
      })).then(() => {
        if (!cancelled) addLog("[信息] recovery 已更新");
      }).catch((error: unknown) => {
        if (!cancelled) addLog(`[错误] recovery 写入失败：${formatError(error)}`);
      });
    }, RECOVERY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [addLog, createSnapshot, dirty, host, projectRoot, savedHostSignature]);
}
