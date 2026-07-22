import { useEffect, useState } from "react";
import type { MotionEditorHost } from "../host/MotionEditorHost";
import { createTauriMotionEditorHost } from "../host/TauriMotionEditorHost";
import type {
  MotionEditorRecoverySnapshotV1,
  RecentMotionEditorProjectV1,
} from "../project/manifest";
import { formatError } from "../lib/errors";

export function useProjectHost({ addLog }: { addLog: (message: string) => void }) {
  const [host, setHost] = useState<MotionEditorHost | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentMotionEditorProjectV1[]>([]);
  const [recoveryCandidates, setRecoveryCandidates] = useState<MotionEditorRecoverySnapshotV1[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!("__TAURI_INTERNALS__" in window)) {
      setHostReady(true);
      return;
    }
    void createTauriMotionEditorHost().then(async (createdHost) => {
      const [recent, recoveries] = await Promise.all([
        createdHost.listRecentProjects(),
        createdHost.readRecoveryCandidates(),
      ]);
      if (cancelled) return;
      setHost(createdHost);
      setRecentProjects(recent);
      setRecoveryCandidates(recoveries);
      addLog(`[信息] Tauri 项目宿主已连接${recoveries.length ? `，发现 ${recoveries.length} 个恢复项` : ""}`);
    }).catch((error: unknown) => {
      if (!cancelled) addLog(`[错误] Tauri 项目宿主初始化失败：${formatError(error)}`);
    }).finally(() => {
      if (!cancelled) setHostReady(true);
    });
    return () => { cancelled = true; };
  }, [addLog]);

  return {
    host, hostReady, hostBusy, setHostBusy,
    recentProjects, setRecentProjects,
    recoveryCandidates, setRecoveryCandidates,
  };
}
