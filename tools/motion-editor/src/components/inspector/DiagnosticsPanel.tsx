import type { ImportResult, Diagnostic } from "../../svgcanvas/SvgCanvasAdapter";
import type {
  MotionEditorProjectBackupV1,
  MotionEditorSchemaCompatibility,
} from "../../project/manifest";

export interface DiagnosticsPanelProps {
  importResult: ImportResult | null;
  compatibility: MotionEditorSchemaCompatibility | null;
  projectRoot: string | null;
  projectBackups: MotionEditorProjectBackupV1[];
  hostBusy: boolean;
  onRestoreBackup: (backup: MotionEditorProjectBackupV1) => Promise<void>;
  diagnostics: Diagnostic[];
}

export function DiagnosticsPanel({
  importResult,
  compatibility,
  projectRoot,
  projectBackups,
  hostBusy,
  onRestoreBackup,
  diagnostics,
}: DiagnosticsPanelProps) {
  return (
    <section className="panel diagnostics-section">
      <h2>诊断</h2>
      <p>{importResult ? `${importResult.parts.length} Part · ${importResult.pivotLocal.size} pivot` : "尚未载入"}</p>
      <p>{compatibility
        ? `兼容：项目 v${compatibility.projectSchema} / Rig v${compatibility.rigSchema} / Motions v${compatibility.motionsSchema}`
        : "兼容范围：项目/Rig/Motions v1"}</p>
      {projectRoot && (
        <details>
          <summary>项目备份（{projectBackups.length}/{5}）</summary>
          {projectBackups.length === 0 ? <p>首次保存后开始保留旧版本</p> : (
            <ul>
              {projectBackups.map((backup) => (
                <li key={backup.backupId}>
                  <button type="button" disabled={hostBusy} onClick={() => void onRestoreBackup(backup)}>
                    恢复 {new Date(backup.createdAtUnixMs).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      <ul>{diagnostics.filter((item) => item.severity !== "info").map((item, index) => <li key={`${item.message}-${index}`} className={`diag-${item.severity}`}>{item.message}</li>)}</ul>
    </section>
  );
}
