import type { MotionEditorRecoverySnapshotV1 } from "../../project/manifest";
import type { MotionEditorHost } from "../../host/MotionEditorHost";
import { formatError } from "../../lib/errors";

export interface RecoveryBannerProps {
  hostReady: boolean;
  recoveryCandidates: MotionEditorRecoverySnapshotV1[];
  host: MotionEditorHost | null;
  hostBusy: boolean;
  onRestoreRecovery: (candidate: MotionEditorRecoverySnapshotV1) => Promise<void>;
  onAddLog: (message: string) => void;
  onSetRecoveryCandidates: (
    updater: (
      current: MotionEditorRecoverySnapshotV1[],
    ) => MotionEditorRecoverySnapshotV1[],
  ) => void;
}

export function RecoveryBanner({
  hostReady,
  recoveryCandidates,
  host,
  hostBusy,
  onRestoreRecovery,
  onAddLog,
  onSetRecoveryCandidates,
}: RecoveryBannerProps) {
  if (!hostReady || recoveryCandidates.length === 0) return null;

  return (
    <section className="recovery-banner" role="status">
      <strong>检测到未保存的 recovery</strong>
      {recoveryCandidates.map((candidate) => (
        <span key={candidate.metadata.projectId}>
          {candidate.snapshot.manifest.displayName} · {new Date(candidate.metadata.createdAtUnixMs).toLocaleString()}
          <button type="button" onClick={() => void onRestoreRecovery(candidate)} disabled={hostBusy}>恢复</button>
          <button type="button" onClick={() => {
            if (!host) return;
            void host.discardRecovery(candidate.metadata.projectId).then(() => {
              onSetRecoveryCandidates((current) => current.filter((item) => item !== candidate));
            }).catch((error: unknown) => onAddLog(`[错误] 丢弃 recovery 失败：${formatError(error)}`));
          }}>丢弃</button>
        </span>
      ))}
    </section>
  );
}
