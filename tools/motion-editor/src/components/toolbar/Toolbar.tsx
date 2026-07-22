import { useRef } from "react";
import type { CharacterRigV1 } from "@ltypet/character-motion";
import type { MotionEditorHost } from "../../host/MotionEditorHost";
import type { SvgCanvasAdapter } from "../../svgcanvas/SvgCanvasAdapter";

const PRODUCTION_PUBLISH_AVAILABLE = import.meta.env.DEV;

export interface ToolbarProps {
  adapterRef: React.RefObject<SvgCanvasAdapter | null>;
  host: MotionEditorHost | null;
  hostBusy: boolean;
  history: { past: unknown[]; future: unknown[] } | null;
  projectRoot: string | null;
  rig: CharacterRigV1 | null;
  dirty: boolean;
  canvasVersion: string;
  onLoadCharacter: () => Promise<void>;
  onChooseAndOpenProject: () => Promise<void>;
  onSaveProject: () => Promise<void>;
  onSaveProjectAs: () => Promise<void>;
  onImportRig: (text: string, name: string) => void;
  onImportMotions: (text: string, name: string) => void;
  onExportProject: () => Promise<void>;
  onPreparePublish: () => Promise<void>;
  onExportDiagnostics: () => Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onImportTextFile: (
    event: React.ChangeEvent<HTMLInputElement>,
    handler: (text: string, name: string) => void,
  ) => void;
}

export function Toolbar({
  adapterRef,
  host,
  hostBusy,
  history,
  projectRoot,
  rig,
  dirty,
  canvasVersion,
  onLoadCharacter,
  onChooseAndOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onImportRig,
  onImportMotions,
  onExportProject,
  onPreparePublish,
  onExportDiagnostics,
  onUndo,
  onRedo,
  onImportTextFile,
}: ToolbarProps) {
  const motionInputRef = useRef<HTMLInputElement>(null);
  const rigInputRef = useRef<HTMLInputElement>(null);

  const dirtyLabel = dirty
    ? "● 未保存"
    : projectRoot
      ? "✓ 已保存"
      : history
        ? "内置项目（未保存为项目）"
        : "尚未载入项目";

  return (
    <header className="toolbar">
      <h1>小洛宝 Animation Studio</h1>
      <div className="controls">
        <button type="button" onClick={() => void onLoadCharacter()} disabled={!adapterRef.current || hostBusy}>载入内置小洛宝</button>
        {host && <button type="button" onClick={() => void onChooseAndOpenProject()} disabled={hostBusy}>打开项目目录</button>}
        {host && <button type="button" onClick={() => void onSaveProject()} disabled={!history || !projectRoot || hostBusy}>保存</button>}
        {host && <button type="button" onClick={() => void onSaveProjectAs()} disabled={!history || hostBusy}>另存为</button>}
        <button type="button" onClick={() => rigInputRef.current?.click()} disabled={!rig}>导入 Rig</button>
        <button type="button" onClick={() => motionInputRef.current?.click()} disabled={!rig}>导入动作</button>
        <button type="button" onClick={() => void onExportProject()} disabled={!history || !host || hostBusy}>导出文件…</button>
        {host && (
          <button
            type="button"
            onClick={() => void onPreparePublish()}
            disabled={!history || hostBusy || !PRODUCTION_PUBLISH_AVAILABLE}
            title={PRODUCTION_PUBLISH_AVAILABLE ? "校验并发布到仓库正式小洛宝资源" : "仅仓库开发模式允许发布正式资源"}
          >
            {PRODUCTION_PUBLISH_AVAILABLE ? "发布到正式资源" : "发布到正式资源（仅开发模式）"}
          </button>
        )}
        {host && <button type="button" onClick={() => void onExportDiagnostics()} disabled={hostBusy}>导出诊断</button>}
        <button type="button" onClick={onUndo} disabled={!history?.past.length} aria-label="撤销">↶</button>
        <button type="button" onClick={onRedo} disabled={!history?.future.length} aria-label="重做">↷</button>
        <input ref={rigInputRef} type="file" accept=".json" hidden onChange={(event) => onImportTextFile(event, onImportRig)} />
        <input ref={motionInputRef} type="file" accept=".json" hidden onChange={(event) => onImportTextFile(event, onImportMotions)} />
      </div>
      <span className={`dirty-indicator ${dirty ? "dirty" : ""}`}>{dirtyLabel}</span>
      {canvasVersion && <span className="version">svgcanvas v{canvasVersion}</span>}
    </header>
  );
}
