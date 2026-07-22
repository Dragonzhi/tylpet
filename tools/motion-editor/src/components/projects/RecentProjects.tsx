import type { MotionEditorHost } from "../../host/MotionEditorHost";
import type { RecentMotionEditorProjectV1 } from "../../project/manifest";
import { formatError } from "../../lib/errors";

export interface RecentProjectsProps {
  host: MotionEditorHost | null;
  recentProjects: RecentMotionEditorProjectV1[];
  hostBusy: boolean;
  onOpenProjectRoot: (root: string) => Promise<void>;
  onRefreshRecentProjects: () => Promise<void>;
  onAddLog: (message: string) => void;
}

export function RecentProjects({
  host,
  recentProjects,
  hostBusy,
  onOpenProjectRoot,
  onRefreshRecentProjects,
  onAddLog,
}: RecentProjectsProps) {
  return (
    <section className="panel recent-projects">
      <h2>最近项目</h2>
      {recentProjects.length === 0 ? <p className="placeholder">暂无最近项目</p> : (
        <ul>
          {recentProjects.map((recent) => (
            <li key={recent.root}>
              <button type="button" title={recent.root} onClick={() => void onOpenProjectRoot(recent.root)} disabled={hostBusy}>{recent.displayName}</button>
              <button type="button" aria-label={`移除最近项目 ${recent.displayName}`} onClick={() => {
                void host!.removeRecentProject(recent.root).then(onRefreshRecentProjects)
                  .catch((error: unknown) => onAddLog(`[错误] 移除最近项目失败：${formatError(error)}`));
              }}>×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
