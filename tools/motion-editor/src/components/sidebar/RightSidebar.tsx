import { useState } from "react";
import type { CharacterRigV1, MotionClipV1, TransformValue, EasingValue, MotionKeyframeV1, SourceBinding } from "@ltypet/character-motion";
import type { ImportResult, Diagnostic } from "../../svgcanvas/SvgCanvasAdapter";
import type { EditorCommand } from "../../editor/model/types";
import type {
  MotionEditorProjectBackupV1,
  MotionEditorSchemaCompatibility,
} from "../../project/manifest";
import { RigInspector } from "../inspector/RigInspector";
import { TransformInspector } from "../inspector/TransformInspector";
import { DiagnosticsPanel } from "../inspector/DiagnosticsPanel";
import { LogPanel } from "../inspector/LogPanel";
import { SidebarPage, SidebarTabs } from "./SidebarTabs";

const RIGHT_TABS = [
  { id: "transform", label: "属性" },
  { id: "rig", label: "骨架" },
  { id: "diagnostics", label: "诊断" },
  { id: "log", label: "日志" },
];

export interface RightSidebarProps {
  rig: CharacterRigV1 | null;
  selectedPartId: string | null;
  currentFrame: number;
  displayedTransform: TransformValue | null;
  exactKeyframe: MotionKeyframeV1 | null;
  activeClip: MotionClipV1 | null;
  // Actions
  onRenamePart: (nextPartId: string) => void;
  onRunCommand: (command: EditorCommand) => boolean;
  onInsertCurrentKeyframe: () => void;
  onUpdateCurrentValues: (values: Partial<MotionKeyframeV1["values"]>) => void;
  onUpdateCurrentEasing: (easing: EasingValue) => void;
  onCommitPivot: (x: number, y: number) => void;
  // Diagnostics
  importResult: ImportResult | null;
  compatibility: MotionEditorSchemaCompatibility | null;
  projectRoot: string | null;
  projectBackups: MotionEditorProjectBackupV1[];
  hostBusy: boolean;
  onRestoreBackup: (backup: MotionEditorProjectBackupV1) => Promise<void>;
  diagnostics: Diagnostic[];
  // Log
  log: string[];
}

export function RightSidebar({
  rig,
  selectedPartId,
  currentFrame,
  displayedTransform,
  exactKeyframe,
  activeClip,
  onRenamePart,
  onRunCommand,
  onInsertCurrentKeyframe,
  onUpdateCurrentValues,
  onUpdateCurrentEasing,
  onCommitPivot,
  importResult,
  compatibility,
  projectRoot,
  projectBackups,
  hostBusy,
  onRestoreBackup,
  diagnostics,
  log,
}: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState("transform");
  // 诊断页徽章：只统计需要处理的问题（与 DiagnosticsPanel 的过滤口径一致）
  const issueCount = diagnostics.filter((item) => item.severity !== "info").length;
  const tabs = RIGHT_TABS.map((tab) =>
    tab.id === "diagnostics" ? { ...tab, badge: issueCount } : tab);
  return (
    <aside className="right-sidebar">
      <SidebarTabs ariaLabel="右侧栏分页" tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <SidebarPage tabId="transform" activeTab={activeTab}>
        {rig ? (
          <TransformInspector
            rig={rig}
            partId={selectedPartId}
            frame={currentFrame}
            sampled={displayedTransform}
            keyframe={exactKeyframe}
            onInsert={onInsertCurrentKeyframe}
            onUpdateValues={onUpdateCurrentValues}
            onRemoveRenderSlot={() => {
              if (!activeClip || !selectedPartId || !exactKeyframe?.values.renderSlot) return;
              onRunCommand({
                type: "keyframe.removeValues",
                clipId: activeClip.id,
                partId: selectedPartId,
                frame: currentFrame,
                properties: ["renderSlot"],
              });
            }}
            onUpdateEasing={onUpdateCurrentEasing}
            onUpdatePivot={onCommitPivot}
          />
        ) : <p className="placeholder panel">载入角色后编辑部件属性</p>}
      </SidebarPage>
      <SidebarPage tabId="rig" activeTab={activeTab}>
        {rig ? (
          <RigInspector
            rig={rig}
            partId={selectedPartId}
            onRenamePart={onRenamePart}
            onUpdateSourceBinding={(sourceBinding: SourceBinding) => {
              if (!selectedPartId) return;
              onRunCommand({ type: "rig.updateSourceBinding", partId: selectedPartId, sourceBinding });
            }}
            onReparent={(logicalParentId: string | null) => {
              if (!selectedPartId) return;
              onRunCommand({ type: "rig.reparent", partId: selectedPartId, logicalParentId });
            }}
            onUpdateDefaultRenderSlot={(renderSlot: string) => {
              if (!selectedPartId) return;
              onRunCommand({ type: "rig.updateDefaultRenderSlot", partId: selectedPartId, renderSlot });
            }}
          />
        ) : <p className="placeholder panel">载入角色后编辑骨架</p>}
      </SidebarPage>
      <SidebarPage tabId="diagnostics" activeTab={activeTab}>
        <DiagnosticsPanel
          importResult={importResult}
          compatibility={compatibility}
          projectRoot={projectRoot}
          projectBackups={projectBackups}
          hostBusy={hostBusy}
          onRestoreBackup={onRestoreBackup}
          diagnostics={diagnostics}
        />
      </SidebarPage>
      <SidebarPage tabId="log" activeTab={activeTab}>
        <LogPanel log={log} />
      </SidebarPage>
    </aside>
  );
}
