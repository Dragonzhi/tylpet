import { useState } from "react";
import type { CharacterRigV1, MotionClipV1, MotionLibraryV1 } from "@ltypet/character-motion";
import type { MotionEditorHost } from "../../host/MotionEditorHost";
import type { EditorCommand, KeyframeRef } from "../../editor/model/types";
import type { RecentMotionEditorProjectV1 } from "../../project/manifest";
import { PartTree } from "../parts/PartTree";
import { ClipPanel } from "../clips/ClipPanel";
import { RecentProjects } from "../projects/RecentProjects";
import { SidebarPage, SidebarTabs } from "./SidebarTabs";

const LEFT_TABS = [
  { id: "parts", label: "部件" },
  { id: "clips", label: "片段" },
  { id: "projects", label: "项目" },
];

export interface LeftSidebarProps {
  rig: CharacterRigV1 | null;
  selectedPartId: string | null;
  hiddenPartIds: Set<string>;
  lockedPartIds: Set<string>;
  onSelectPart: (partId: string) => void;
  onToggleHiddenPart: (partId: string) => void;
  onToggleLockedPart: (partId: string) => void;
  // ClipPanel props
  history: { present: unknown; past: unknown[]; future: unknown[] } | null;
  activeClip: MotionClipV1 | null;
  motionLibrary: MotionLibraryV1 | null;
  activeClipId: string | null;
  onSetActiveClipId: (id: string | null) => void;
  onSetCurrentFrame: (frame: number | ((prev: number) => number)) => void;
  onSetSelectedKeyframes: (keyframes: KeyframeRef[] | ((prev: KeyframeRef[]) => KeyframeRef[])) => void;
  onRunCommand: (command: EditorCommand) => boolean;
  onStopAnimation: () => void;
  // RecentProjects props
  host: MotionEditorHost | null;
  recentProjects: RecentMotionEditorProjectV1[];
  hostBusy: boolean;
  onOpenProjectRoot: (root: string) => Promise<void>;
  onRefreshRecentProjects: () => Promise<void>;
  onAddLog: (message: string) => void;
}

export function LeftSidebar({
  rig,
  selectedPartId,
  hiddenPartIds,
  lockedPartIds,
  onSelectPart,
  onToggleHiddenPart,
  onToggleLockedPart,
  history,
  activeClip,
  motionLibrary,
  activeClipId,
  onSetActiveClipId,
  onSetCurrentFrame,
  onSetSelectedKeyframes,
  onRunCommand,
  onStopAnimation,
  host,
  recentProjects,
  hostBusy,
  onOpenProjectRoot,
  onRefreshRecentProjects,
  onAddLog,
}: LeftSidebarProps) {
  const [activeTab, setActiveTab] = useState("parts");
  return (
    <aside className="left-sidebar">
      <SidebarTabs ariaLabel="左侧栏分页" tabs={LEFT_TABS} activeTab={activeTab} onChange={setActiveTab} />
      <SidebarPage tabId="parts" activeTab={activeTab}>
        {rig ? (
          <PartTree
            rig={rig}
            selectedPartId={selectedPartId}
            hiddenPartIds={hiddenPartIds}
            lockedPartIds={lockedPartIds}
            onSelect={onSelectPart}
            onToggleHidden={onToggleHiddenPart}
            onToggleLocked={onToggleLockedPart}
          />
        ) : <p className="placeholder panel">请先初始化并载入角色</p>}
      </SidebarPage>
      <SidebarPage tabId="clips" activeTab={activeTab}>
        <ClipPanel
          history={history}
          activeClip={activeClip}
          motionLibrary={motionLibrary}
          activeClipId={activeClipId}
          onSetActiveClipId={onSetActiveClipId}
          onSetCurrentFrame={onSetCurrentFrame}
          onSetSelectedKeyframes={onSetSelectedKeyframes}
          onRunCommand={onRunCommand}
          onStopAnimation={onStopAnimation}
        />
      </SidebarPage>
      <SidebarPage tabId="projects" activeTab={activeTab}>
        {host ? (
          <RecentProjects
            host={host}
            recentProjects={recentProjects}
            hostBusy={hostBusy}
            onOpenProjectRoot={onOpenProjectRoot}
            onRefreshRecentProjects={onRefreshRecentProjects}
            onAddLog={onAddLog}
          />
        ) : <p className="placeholder panel">最近项目在桌面端可用</p>}
      </SidebarPage>
    </aside>
  );
}
