import { useCallback, useEffect, useRef, useState } from "react";
import { useLog } from "./hooks/useLog";
import { useProjectDocument } from "./hooks/useProjectDocument";
import { useProjectHost } from "./hooks/useProjectHost";
import { useCanvasAdapter } from "./hooks/useCanvasAdapter";
import { useStagePan } from "./hooks/useStagePan";
import { useEditorSession } from "./hooks/useEditorSession";
import { usePlayback } from "./hooks/usePlayback";
import { useStagePreview } from "./hooks/useStagePreview";
import { useKeyframeEditing } from "./hooks/useKeyframeEditing";
import { useProjectActions } from "./hooks/useProjectActions";
import { useRecoveryAutosave } from "./hooks/useRecoveryAutosave";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { Toolbar } from "./components/toolbar/Toolbar";
import { RecoveryBanner } from "./components/recovery/RecoveryBanner";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { StageArea } from "./components/stage/StageArea";
import { RightSidebar } from "./components/sidebar/RightSidebar";
import { BottomEditor } from "./components/playback/BottomEditor";
import { PublishDialog } from "./components/publish/PublishDialog";

export default function App() {
  const stageRef = useRef<HTMLElement>(null);
  const [pixelsPerFrame, setPixelsPerFrame] = useState(8);
  const { log, addLog } = useLog();
  const doc = useProjectDocument();
  const ph = useProjectHost({ addLog });

  const onPartSelectedRef = useRef<(partId: string) => void>(() => {});
  const { containerRef, adapterRef, canvasVersion } = useCanvasAdapter({
    addLog, onPartSelected: (partId: string) => onPartSelectedRef.current(partId),
  });
  const { stagePan, setStagePan, panHandlers } = useStagePan();

  const stopAnimationRef = useRef<() => void>(() => {});
  const session = useEditorSession({
    addLog, stopAnimation: () => stopAnimationRef.current(),
  });
  const {
    history, activeClipId, selectedPartId, selectedKeyframes,
    clipboard, hiddenPartIds, lockedPartIds, tool,
    transformDraft, setTransformDraft, pivotDraft, setPivotDraft,
    setActiveClipId, setSelectedPartId, setSelectedKeyframes,
    setClipboard, setHiddenPartIds, setLockedPartIds, setTool,
    rig, motionLibrary, activeClip, dirty,
    runCommand, renamePart, toggleHiddenPart, toggleLockedPart,
    undo: sessionUndo, redo: sessionRedo, setHistory,
  } = session;

  onPartSelectedRef.current = (partId: string) => {
    setSelectedPartId(partId);
    setSelectedKeyframes([]);
  };

  const playback = usePlayback({ activeClip });
  const { currentFrame, setCurrentFrame, isPlaying, togglePlay, stopAnimation } = playback;
  stopAnimationRef.current = stopAnimation;

  const { geometry, requestGeometry } = useStagePreview({
    adapterRef, stageRef, rig, activeClip, currentFrame,
    selectedPartId, transformDraft, pivotDraft,
    hiddenPartIds, lockedPartIds, stagePan,
  });

  const kf = useKeyframeEditing({
    adapterRef, rig, activeClip, selectedPartId, setSelectedPartId,
    selectedKeyframes, setSelectedKeyframes,
    clipboard, setClipboard,
    transformDraft, setTransformDraft, pivotDraft, setPivotDraft,
    currentFrame, setCurrentFrame,
    history, runCommand, addLog, requestGeometry,
  });
  const {
    displayedTransform, exactKeyframe, displayedPivot,
    selectPart, insertCurrentKeyframe, deleteCurrentKeyframe,
    updateCurrentValues, updateCurrentEasing,
    commitTransform, commitPivot,
    selectKeyframe, moveKeyframes,
    copySelected, pasteSelected, deleteSelected,
  } = kf;

  const actions = useProjectActions({
    adapterRef, host: ph.host, setHostBusy: ph.setHostBusy,
    setRecentProjects: ph.setRecentProjects, setRecoveryCandidates: ph.setRecoveryCandidates,
    artwork: doc.artwork, setArtwork: doc.setArtwork,
    manifest: doc.manifest, setManifest: doc.setManifest,
    fingerprint: doc.fingerprint, setFingerprint: doc.setFingerprint,
    projectRoot: doc.projectRoot, setProjectRoot: doc.setProjectRoot,
    savedHostSignature: doc.savedHostSignature, setSavedHostSignature: doc.setSavedHostSignature,
    importResult: doc.importResult, setImportResult: doc.setImportResult,
    diagnostics: doc.diagnostics, setDiagnostics: doc.setDiagnostics,
    compatibility: doc.compatibility, setCompatibility: doc.setCompatibility,
    projectBackups: doc.projectBackups, setProjectBackups: doc.setProjectBackups,
    publishPlan: doc.publishPlan, setPublishPlan: doc.setPublishPlan,
    history, setHistory, activeClipId, setActiveClipId,
    setSelectedPartId, setSelectedKeyframes,
    setHiddenPartIds, setLockedPartIds, setStagePan,
    stopAnimation, setCurrentFrame, pixelsPerFrame, addLog,
  });
  const {
    handleLoadCharacter, openProjectRoot, chooseAndOpenProject,
    restoreRecovery, saveProject, saveProjectAs,
    restoreBackup, exportDiagnostics,
    preparePublish, commitPublish, cancelPublish,
    exportProject, importRig, importMotions, importTextFile,
    refreshRecentProjects,
  } = actions;

  const moveSelectedKeyframes = useCallback((delta: number) => {
    moveKeyframes(selectedKeyframes, delta);
  }, [moveKeyframes, selectedKeyframes]);

  const onFrameChange = useCallback((frame: number) => {
    stopAnimation(); setCurrentFrame(frame);
  }, [stopAnimation, setCurrentFrame]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useRecoveryAutosave({
    host: ph.host, dirty, createSnapshot: actions.createSnapshot,
    projectRoot: doc.projectRoot, savedHostSignature: doc.savedHostSignature, addLog,
  });

  useKeyboardShortcuts({
    activeClipDuration: activeClip?.durationFrames,
    insertCurrentKeyframe, deleteCurrentKeyframe,
    undo: sessionUndo, redo: sessionRedo, copySelected, pasteSelected, deleteSelected,
    togglePlay, stopAnimation, setCurrentFrame,
    moveSelectedKeyframes,
    hasSelectedKeyframes: selectedKeyframes.length > 0,
    cancelDrafts: () => { setTransformDraft(null); setPivotDraft(null); },
  });

  return (
    <div className="app p4-editor">
      <Toolbar adapterRef={adapterRef} host={ph.host} hostBusy={ph.hostBusy}
        history={history} projectRoot={doc.projectRoot} rig={rig}
        dirty={dirty} canvasVersion={canvasVersion}
        onLoadCharacter={handleLoadCharacter} onChooseAndOpenProject={chooseAndOpenProject}
        onSaveProject={saveProject} onSaveProjectAs={saveProjectAs}
        onImportRig={importRig} onImportMotions={importMotions}
        onExportProject={exportProject} onPreparePublish={preparePublish}
        onExportDiagnostics={exportDiagnostics} onUndo={sessionUndo} onRedo={sessionRedo}
        onImportTextFile={importTextFile} />
      <RecoveryBanner hostReady={ph.hostReady}
        recoveryCandidates={ph.recoveryCandidates} host={ph.host}
        hostBusy={ph.hostBusy} onRestoreRecovery={restoreRecovery}
        onAddLog={addLog} onSetRecoveryCandidates={ph.setRecoveryCandidates} />
      <LeftSidebar rig={rig} selectedPartId={selectedPartId}
        hiddenPartIds={hiddenPartIds} lockedPartIds={lockedPartIds}
        onSelectPart={selectPart} onToggleHiddenPart={toggleHiddenPart}
        onToggleLockedPart={toggleLockedPart}
        history={history} activeClip={activeClip} motionLibrary={motionLibrary}
        activeClipId={activeClipId} onSetActiveClipId={setActiveClipId}
        onSetCurrentFrame={setCurrentFrame}
        onSetSelectedKeyframes={setSelectedKeyframes}
        onRunCommand={runCommand} onStopAnimation={stopAnimation}
        host={ph.host} recentProjects={ph.recentProjects} hostBusy={ph.hostBusy}
        onOpenProjectRoot={openProjectRoot}
        onRefreshRecentProjects={refreshRecentProjects} onAddLog={addLog} />
      <StageArea stageRef={stageRef} panHandlers={panHandlers}
        containerRef={containerRef} tool={tool} onSetTool={setTool}
        activeClip={activeClip} selectedPartId={selectedPartId}
        exactKeyframe={exactKeyframe} displayedTransform={displayedTransform}
        displayedPivot={displayedPivot} lockedPartIds={lockedPartIds}
        geometry={geometry} adapterRef={adapterRef} stagePan={stagePan}
        onInsertCurrentKeyframe={insertCurrentKeyframe}
        onDeleteCurrentKeyframe={deleteCurrentKeyframe}
        onCommitTransform={commitTransform} onCommitPivot={commitPivot}
        onSetTransformDraft={setTransformDraft}
        onSetPivotDraft={setPivotDraft} onAddLog={addLog} />
      <RightSidebar rig={rig} selectedPartId={selectedPartId}
        currentFrame={currentFrame} displayedTransform={displayedTransform}
        exactKeyframe={exactKeyframe} activeClip={activeClip}
        onRenamePart={renamePart} onRunCommand={runCommand}
        onInsertCurrentKeyframe={insertCurrentKeyframe}
        onUpdateCurrentValues={updateCurrentValues}
        onUpdateCurrentEasing={updateCurrentEasing}
        onCommitPivot={commitPivot}
        importResult={doc.importResult} compatibility={doc.compatibility}
        projectRoot={doc.projectRoot} projectBackups={doc.projectBackups}
        hostBusy={ph.hostBusy} onRestoreBackup={restoreBackup}
        diagnostics={doc.diagnostics} log={log} />
      <BottomEditor activeClip={activeClip} currentFrame={currentFrame}
        isPlaying={isPlaying} selectedKeyframes={selectedKeyframes}
        clipboard={clipboard} pixelsPerFrame={pixelsPerFrame}
        rig={rig} selectedPartId={selectedPartId}
        onSetCurrentFrame={setCurrentFrame} onTogglePlay={togglePlay}
        onCopySelected={copySelected} onPasteSelected={pasteSelected}
        onDeleteSelected={deleteSelected}
        onPixelsPerFrameChange={setPixelsPerFrame}
        onFrameChange={onFrameChange} onSelectKeyframe={selectKeyframe}
        onMoveKeyframes={moveKeyframes} onRunCommand={runCommand} />
      <PublishDialog publishPlan={doc.publishPlan}
        onCancelPublish={cancelPublish} onCommitPublish={commitPublish}
        hostBusy={ph.hostBusy} />
    </div>
  );
}
