import { useCallback } from "react";
import type { MotionLibraryV1 } from "@ltypet/character-motion";
import { validateMotionLibrary } from "@ltypet/character-motion";
import type { KeyframeRef } from "../editor/model/types";
import {
  createEditorHistory,
  isEditorHistoryDirty,
  markEditorHistorySaved,
} from "../editor/history/EditorHistory";
import {
  parseV1Project,
  parseMotionLibraryForRig,
  parseRigForArtwork,
} from "../project/v1Project";
import type {
  MotionEditorProjectSnapshot,
  MotionEditorProjectManifestV1,
  MotionEditorProjectBackupV1,
  MotionEditorRecoverySnapshotV1,
  MotionEditorSchemaCompatibility,
  ProductionPublishPlan,
  RecentMotionEditorProjectV1,
} from "../project/manifest";
import type { SvgCanvasAdapter, ImportResult, Diagnostic } from "../svgcanvas/SvgCanvasAdapter";
import type { MotionEditorHost } from "../host/MotionEditorHost";
import { formatError } from "../lib/errors";
import { sha256Text, projectDocumentText } from "../lib/projectText";
import { BUILT_IN_MANIFEST } from "../project/builtInProject";
import builtInArtwork from "../../../../src/assets/character/xiaoluobao/artwork.svg?raw";
import builtInRig from "../../../../src/assets/character/xiaoluobao/rig.v1.json?raw";
import builtInMotions from "../../../../src/assets/character/xiaoluobao/motions.v1.json?raw";

export interface UseProjectActionsOptions {
  adapterRef: React.RefObject<SvgCanvasAdapter | null>;
  host: MotionEditorHost | null;
  setHostBusy: (busy: boolean) => void;
  setRecentProjects: (projects: RecentMotionEditorProjectV1[] | ((prev: RecentMotionEditorProjectV1[]) => RecentMotionEditorProjectV1[])) => void;
  setRecoveryCandidates: (candidates: MotionEditorRecoverySnapshotV1[] | ((prev: MotionEditorRecoverySnapshotV1[]) => MotionEditorRecoverySnapshotV1[])) => void;
  // doc states
  artwork: string;
  setArtwork: (artwork: string) => void;
  manifest: MotionEditorProjectManifestV1;
  setManifest: (manifest: MotionEditorProjectManifestV1) => void;
  fingerprint: string;
  setFingerprint: (fingerprint: string) => void;
  projectRoot: string | null;
  setProjectRoot: (root: string | null) => void;
  savedHostSignature: string;
  setSavedHostSignature: (sig: string) => void;
  importResult: ImportResult | null;
  setImportResult: (result: ImportResult | null) => void;
  diagnostics: Diagnostic[];
  setDiagnostics: (diagnostics: Diagnostic[]) => void;
  compatibility: MotionEditorSchemaCompatibility | null;
  setCompatibility: (compat: MotionEditorSchemaCompatibility | null) => void;
  projectBackups: MotionEditorProjectBackupV1[];
  setProjectBackups: (backups: MotionEditorProjectBackupV1[]) => void;
  publishPlan: ProductionPublishPlan | null;
  setPublishPlan: (plan: ProductionPublishPlan | null) => void;
  // session states
  history: ReturnType<typeof createEditorHistory> | null;
  setHistory: (history: ReturnType<typeof createEditorHistory> | null | ((prev: ReturnType<typeof createEditorHistory> | null) => ReturnType<typeof createEditorHistory> | null)) => void;
  activeClipId: string | null;
  setActiveClipId: (id: string | null) => void;
  setSelectedPartId: (id: string | null) => void;
  setSelectedKeyframes: (keyframes: KeyframeRef[] | ((prev: KeyframeRef[]) => KeyframeRef[])) => void;
  setHiddenPartIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setLockedPartIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setStagePan: (pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  // playback
  stopAnimation: () => void;
  setCurrentFrame: (frame: number | ((prev: number) => number)) => void;
  // other
  pixelsPerFrame: number;
  setPixelsPerFrame?: (ppf: number) => void;
  addLog: (message: string) => void;
}

export function useProjectActions(options: UseProjectActionsOptions) {
  const {
    adapterRef, host, setHostBusy, setRecentProjects, setRecoveryCandidates,
    artwork, setArtwork, manifest, setManifest,
    fingerprint, setFingerprint, projectRoot, setProjectRoot,
    setSavedHostSignature,
    importResult, setImportResult, setDiagnostics,
    setCompatibility, setProjectBackups,
    publishPlan, setPublishPlan,
    history, setHistory, activeClipId, setActiveClipId,
    setSelectedPartId, setSelectedKeyframes,
    setHiddenPartIds, setLockedPartIds, setStagePan,
    stopAnimation, setCurrentFrame, pixelsPerFrame, setPixelsPerFrame, addLog,
  } = options;

  const mayReplaceProject = useCallback(() => {
    const dirty = history ? isEditorHistoryDirty(history) : false;
    return !dirty || window.confirm("当前项目有未保存的修改，确定替换吗？");
  }, [history]);

  const applyOpenedProject = useCallback(async (
    snapshot: MotionEditorProjectSnapshot,
    opts: { root: string | null; savedSignature?: string; recovered?: boolean },
  ) => {
    const adapter = adapterRef.current;
    if (!adapter) throw new Error("画布尚未初始化");
    const opened = await parseV1Project({
      artwork: snapshot.artwork,
      artworkSource: snapshot.rig.artwork.source,
      rig: snapshot.rig,
      motions: snapshot.motions,
    });
    const imported = adapter.loadSvg(opened.artwork);
    const importErrors = imported.diagnostics.filter((item) => item.severity === "error");
    if (importErrors.length > 0) {
      throw new Error(`SVG 舞台载入失败：${importErrors.map((item) => item.message).join("；")}`);
    }
    const bound = adapter.bindRig(opened.rig);
    const bindingErrors = bound.diagnostics.filter((item) => item.severity === "error");
    if (bindingErrors.length > 0) {
      throw new Error(`Rig 舞台绑定失败：${bindingErrors.map((item) => item.message).join("；")}`);
    }
    stopAnimation();
    setArtwork(opened.artwork);
    setFingerprint(opened.fingerprint);
    setManifest(snapshot.manifest);
    setProjectRoot(opts.root);
    if (!opts.root) {
      setProjectBackups([]);
      setCompatibility(null);
    }
    setSavedHostSignature(opts.savedSignature ?? await sha256Text(projectDocumentText(snapshot)));
    setDiagnostics([...imported.diagnostics, ...bound.diagnostics]);
    setImportResult(bound);
    const nextHistory = createEditorHistory({ rig: opened.rig, motions: opened.motions });
    setHistory(opts.recovered ? { ...nextHistory, savedSignature: `recovery:${Date.now()}` } : nextHistory);
    const firstClipId = snapshot.editor.activeClipId && opened.motions.clips.some((clip) => clip.id === snapshot.editor.activeClipId)
      ? snapshot.editor.activeClipId
      : opened.motions.clips[0]?.id ?? null;
    setActiveClipId(firstClipId);
    setCurrentFrame(0);
    setPixelsPerFrame?.(snapshot.editor.timelineScale ?? 8);
    setHiddenPartIds(new Set());
    setLockedPartIds(new Set());
    setStagePan({ x: 0, y: 0 });
    const firstPart = opened.motions.clips.find((clip) => clip.id === firstClipId)?.tracks[0]?.partId
      ?? opened.rig.parts[0]?.id
      ?? null;
    setSelectedPartId(firstPart);
    setSelectedKeyframes([]);
    if (firstPart) adapter.selectPart(firstPart);
    addLog(`[信息] 已载入 ${snapshot.manifest.displayName}：${opened.rig.parts.length} 个 Part，${opened.motions.clips.length} 个 Clip`);
  }, [adapterRef, stopAnimation, setArtwork, setFingerprint, setManifest, setProjectRoot,
      setProjectBackups, setCompatibility, setSavedHostSignature, setDiagnostics, setImportResult,
      setHistory, setActiveClipId, setCurrentFrame, setSelectedPartId, setSelectedKeyframes,
      setHiddenPartIds, setLockedPartIds, setStagePan, addLog]);

  const handleLoadCharacter = useCallback(async () => {
    if (!adapterRef.current || !mayReplaceProject()) return;
    try {
      await applyOpenedProject({
        manifest: BUILT_IN_MANIFEST,
        artwork: builtInArtwork,
        rig: JSON.parse(builtInRig) as unknown,
        motions: JSON.parse(builtInMotions) as unknown,
        editor: { schemaVersion: 1, activeClipId: "bow", timelineScale: 8, expandedPartIds: [] },
      } as MotionEditorProjectSnapshot, { root: null });
    } catch (error: unknown) {
      addLog(`[错误] 载入内置小洛宝失败：${formatError(error)}`);
    }
  }, [adapterRef, mayReplaceProject, applyOpenedProject, addLog]);

  const openProjectRoot = useCallback(async (root: string) => {
    if (!host || !mayReplaceProject()) return;
    setHostBusy(true);
    try {
      const snapshot = await host.readProject(root);
      await applyOpenedProject(snapshot, { root });
      const [recent, backups, schema] = await Promise.all([
        host.listRecentProjects(),
        host.listProjectBackups(root),
        host.getProjectCompatibility(root),
      ]);
      setRecentProjects(recent);
      setProjectBackups(backups);
      setCompatibility(schema);
    } catch (error: unknown) {
      addLog(`[错误] 打开项目失败：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [host, mayReplaceProject, setHostBusy, applyOpenedProject, setRecentProjects, setProjectBackups, setCompatibility, addLog]);

  const chooseAndOpenProject = useCallback(async () => {
    if (!host || !mayReplaceProject()) return;
    setHostBusy(true);
    try {
      const root = await host.chooseProjectDirectory();
      if (!root) return;
      const snapshot = await host.readProject(root);
      await applyOpenedProject(snapshot, { root });
      const [recent, backups, schema] = await Promise.all([
        host.listRecentProjects(),
        host.listProjectBackups(root),
        host.getProjectCompatibility(root),
      ]);
      setRecentProjects(recent);
      setProjectBackups(backups);
      setCompatibility(schema);
    } catch (error: unknown) {
      addLog(`[错误] 打开项目失败：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [host, mayReplaceProject, setHostBusy, applyOpenedProject, setRecentProjects, setProjectBackups, setCompatibility, addLog]);

  const restoreRecovery = useCallback(async (candidate: MotionEditorRecoverySnapshotV1) => {
    if (!mayReplaceProject()) return;
    setHostBusy(true);
    try {
      await applyOpenedProject(candidate.snapshot, {
        root: null,
        savedSignature: candidate.metadata.savedSignature,
        recovered: true,
      });
      setRecoveryCandidates((current) => current.filter((item) => item.metadata.projectId !== candidate.metadata.projectId));
      addLog("[提示] 已恢复自动保存副本，请另存为项目以保留修改");
    } catch (error: unknown) {
      addLog(`[错误] 恢复项目失败：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [mayReplaceProject, setHostBusy, applyOpenedProject, setRecoveryCandidates, addLog]);

  const createSnapshot = useCallback((): MotionEditorProjectSnapshot | null => {
    if (!history || !artwork) return null;
    return {
      manifest: {
        ...manifest,
        characterRigId: history.present.rig.rigId,
      },
      artwork,
      rig: history.present.rig,
      motions: history.present.motions,
      editor: {
        schemaVersion: 1,
        ...(activeClipId ? { activeClipId } : {}),
        timelineScale: pixelsPerFrame,
        expandedPartIds: [],
      },
    };
  }, [activeClipId, artwork, history, manifest, pixelsPerFrame]);

  const refreshRecentProjects = useCallback(async () => {
    if (host) setRecentProjects(await host.listRecentProjects());
  }, [host, setRecentProjects]);

  const refreshProjectSafety = useCallback(async (root: string) => {
    if (!host) return;
    const [backups, schema] = await Promise.all([
      host.listProjectBackups(root),
      host.getProjectCompatibility(root),
    ]);
    setProjectBackups(backups);
    setCompatibility(schema);
  }, [host, setProjectBackups, setCompatibility]);

  const saveProject = useCallback(async () => {
    const snapshot = createSnapshot();
    if (!host || !projectRoot || !snapshot) return;
    setHostBusy(true);
    try {
      const result = await host.saveProject(projectRoot, snapshot);
      setProjectRoot(result.root);
      setSavedHostSignature(result.signature);
      setHistory((current) => current ? markEditorHistorySaved(current) : current);
      await host.discardRecovery(snapshot.manifest.projectId);
      setRecoveryCandidates((current) => current.filter((item) => item.metadata.projectId !== snapshot.manifest.projectId));
      await refreshRecentProjects();
      await refreshProjectSafety(result.root);
      addLog(`[信息] 项目保存成功：${result.root}${result.backupId ? `；已保留备份 ${result.backupId}` : ""}`);
    } catch (error: unknown) {
      addLog(`[错误] 项目保存失败，修改仍标记为未保存：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [createSnapshot, host, projectRoot, setHostBusy, setProjectRoot, setSavedHostSignature,
      setHistory, setRecoveryCandidates, refreshRecentProjects, refreshProjectSafety, addLog]);

  const saveProjectAs = useCallback(async () => {
    const snapshot = createSnapshot();
    if (!host || !snapshot) return;
    setHostBusy(true);
    try {
      const target = await host.chooseProjectDirectory();
      if (!target) return;
      const result = await host.saveProjectAs(target, snapshot);
      setProjectRoot(result.root);
      setSavedHostSignature(result.signature);
      setHistory((current) => current ? markEditorHistorySaved(current) : current);
      await host.discardRecovery(snapshot.manifest.projectId);
      setRecoveryCandidates((current) => current.filter((item) => item.metadata.projectId !== snapshot.manifest.projectId));
      await refreshRecentProjects();
      await refreshProjectSafety(result.root);
      addLog(`[信息] 项目另存成功：${result.root}`);
    } catch (error: unknown) {
      addLog(`[错误] 项目另存失败，修改仍标记为未保存：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [createSnapshot, host, setHostBusy, setProjectRoot, setSavedHostSignature,
      setHistory, setRecoveryCandidates, refreshRecentProjects, refreshProjectSafety, addLog]);

  const restoreBackup = useCallback(async (backup: MotionEditorProjectBackupV1) => {
    if (!host || !projectRoot) return;
    if (!window.confirm(`恢复 ${new Date(backup.createdAtUnixMs).toLocaleString()} 的项目版本？当前版本会先自动备份。`)) return;
    setHostBusy(true);
    try {
      const result = await host.restoreProjectBackup(projectRoot, backup.backupId);
      const snapshot = await host.readProject(result.root);
      await applyOpenedProject(snapshot, { root: result.root, savedSignature: result.signature });
      await refreshProjectSafety(result.root);
      addLog(`[信息] 已恢复备份 ${backup.backupId}；恢复前版本也已保留`);
    } catch (error: unknown) {
      addLog(`[错误] 备份恢复失败，当前项目未被替换：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [host, projectRoot, setHostBusy, applyOpenedProject, refreshProjectSafety, addLog]);

  const exportDiagnostics = useCallback(async () => {
    if (!host) return;
    try {
      const result = await host.exportDiagnostics();
      addLog(result.path ? `[信息] 已导出脱敏诊断：${result.path}` : "[信息] 已取消诊断导出");
    } catch (error: unknown) {
      addLog(`[错误] 诊断导出失败：${formatError(error)}`);
    }
  }, [host, addLog]);

  const preparePublish = useCallback(async () => {
    const snapshot = createSnapshot();
    if (!host || !snapshot) return;
    setHostBusy(true);
    try {
      setPublishPlan(await host.prepareProductionPublish(snapshot));
    } catch (error: unknown) {
      addLog(`[错误] 发布准备失败：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [createSnapshot, host, setHostBusy, setPublishPlan, addLog]);

  const commitPublish = useCallback(async () => {
    if (!host || !publishPlan) return;
    const plan = publishPlan;
    setHostBusy(true);
    try {
      const path = await host.commitProductionPublish(plan.planId);
      setPublishPlan(null);
      addLog(`[信息] 正式资源发布成功：${path}`);
    } catch (error: unknown) {
      addLog(`[错误] 发布提交失败：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [host, publishPlan, setHostBusy, setPublishPlan, addLog]);

  const cancelPublish = useCallback(async () => {
    if (!host || !publishPlan) return;
    const plan = publishPlan;
    setPublishPlan(null);
    try {
      await host.cancelProductionPublish(plan.planId);
      addLog("[信息] 已取消发布");
    } catch (error: unknown) {
      addLog(`[错误] 取消发布失败：${formatError(error)}`);
    }
  }, [host, publishPlan, setPublishPlan, addLog]);

  const exportProject = useCallback(async () => {
    const snapshot = createSnapshot();
    if (!host || !snapshot) return;
    setHostBusy(true);
    try {
      const result = await host.exportCanonicalAssets(snapshot);
      addLog(result
        ? `[信息] 已导出 rig 和 motions：${snapshot.motions.clips.length} 个 Clip；目录：${result.directory}`
        : "[信息] 已取消 rig 和 motions 导出");
    } catch (error: unknown) {
      addLog(`[错误] rig 和 motions 导出失败：${formatError(error)}`);
    } finally {
      setHostBusy(false);
    }
  }, [createSnapshot, host, setHostBusy, addLog]);

  const importRig = useCallback((text: string, name: string) => {
    if (!history || !importResult || !fingerprint || !mayReplaceProject()) return;
    try {
      const nextRig = parseRigForArtwork(text, importResult, { source: manifest.files.artwork, fingerprint });
      const validation = validateMotionLibrary(history.present.motions, nextRig);
      const motions: MotionLibraryV1 = validation.ok
        ? validation.value
        : { schemaVersion: 1 as const, rigId: nextRig.rigId, clips: [] };
      setHistory(createEditorHistory({ rig: nextRig, motions }));
      setActiveClipId(motions.clips[0]?.id ?? null);
      addLog(`[信息] 已导入 Rig：${name}`);
    } catch (error: unknown) {
      addLog(`[错误] Rig 导入失败：${formatError(error)}`);
    }
  }, [history, importResult, fingerprint, mayReplaceProject, manifest, setHistory, setActiveClipId, addLog]);

  const importMotions = useCallback((text: string, name: string) => {
    if (!history || !mayReplaceProject()) return;
    try {
      const rig = history.present.rig;
      const motions = parseMotionLibraryForRig(text, rig);
      setHistory(createEditorHistory({ rig, motions }));
      const first = motions.clips[0] ?? null;
      setActiveClipId(first?.id ?? null);
      setCurrentFrame(0);
      if (first?.tracks[0]) {
        const partId = first.tracks[0].partId;
        setSelectedPartId(partId);
        setSelectedKeyframes([]);
        adapterRef.current?.selectPart(partId);
      }
      addLog(`[信息] 已导入动作库 ${name}：${motions.clips.length} 个 Clip`);
    } catch (error: unknown) {
      addLog(`[错误] 动作导入失败：${formatError(error)}`);
    }
  }, [history, mayReplaceProject, setHistory, setActiveClipId, setCurrentFrame, setSelectedPartId, setSelectedKeyframes, adapterRef, addLog]);

  const importTextFile = useCallback((
    event: React.ChangeEvent<HTMLInputElement>,
    handler: (text: string, name: string) => void,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? handler(reader.result, file.name)
      : addLog(`[错误] 无法读取 ${file.name}`);
    reader.onerror = () => addLog(`[错误] 读取 ${file.name} 失败`);
    reader.readAsText(file);
  }, [addLog]);

  return {
    createSnapshot,
    mayReplaceProject,
    applyOpenedProject,
    handleLoadCharacter,
    openProjectRoot,
    chooseAndOpenProject,
    restoreRecovery,
    saveProject,
    saveProjectAs,
    restoreBackup,
    exportDiagnostics,
    preparePublish,
    commitPublish,
    cancelPublish,
    exportProject,
    importRig,
    importMotions,
    importTextFile,
    refreshRecentProjects,
  };
}
