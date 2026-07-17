import { useState, useEffect, useRef, useCallback } from "react";
import { SvgCanvasAdapter } from "./svgcanvas/SvgCanvasAdapter";
import type { StageAdapter, ImportResult } from "./svgcanvas/SvgCanvasAdapter";
import { inspectParts } from "./import/inspectSvg";
import type { InspectResult, PivotPosition } from "./import/inspectSvg";
import { interpolateKeyframes } from "./motion/interpolate";
import type { MotionKeyframe } from "./motion/interpolate";
import {
  DEFAULT_EXPERIMENTAL_CLIP,
  type ExperimentalClip,
} from "./motion/experimentalMotion";
import {
  serializeProject,
  parseProject,
  type ExperimentalProject,
} from "./project/experimentalProject";

/** SHA-256 fingerprint (async, Web Crypto) */
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<StageAdapter | null>(null);
  const animationRef = useRef<number | null>(null);
  const frameTimeRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [svgUrl, setSvgUrl] = useState<string>("");
  const [fingerprint, setFingerprint] = useState<string>("");
  const [svgText, setSvgText] = useState<string>("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [canvasVersion, setCanvasVersion] = useState<string>("");
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [pivotInfo, setPivotInfo] = useState<PivotPosition | null>(null);

  // Animation state
  const [clip, setClip] = useState<ExperimentalClip>(DEFAULT_EXPERIMENTAL_CLIP);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(true);

  const addLog = (msg: string) => setLog((p) => [...p.slice(-99), msg]);

  // Load default sample on mount
  useEffect(() => {
    const url = "/src/assets/小洛宝.glax.svg";
    fetch(url)
      .then((r) => {
        if (!r.ok) {
          addLog(`[错误] 无法加载默认样例: ${url} (${r.status})`);
          return null;
        }
        return r.text();
      })
      .then(async (text) => {
        if (!text) return;
        setSvgUrl(url);
        setSvgText(text);
        const fp = await sha256(text);
        setFingerprint(fp);
        addLog(`[信息] 默认样例指纹: sha256:${fp}`);
        addLog("[信息] 素材已加载，点击「初始化画布」创建舞台。");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInit = () => {
    if (!containerRef.current) return;
    const adapter = new SvgCanvasAdapter();
    adapterRef.current = adapter;

    try {
      adapter.mount(containerRef.current);
      setCanvasVersion(adapter.getVersion());
      addLog(`[信息] svgcanvas 版本: ${adapter.getVersion()}`);
      addLog("[信息] 画布初始化完成。");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`[错误] 画布初始化失败: ${msg}`);
    }
  };

  const handleLoadSample = async () => {
    const adapter = adapterRef.current;
    if (!adapter || !svgText) return;

    try {
      addLog(`[信息] 载入 ${svgUrl} (${svgText.length} 字符)`);

      // Run inspection for pivot data
      const insp = inspectParts(svgText);
      setInspectResult(insp);
      if (insp.diags.length) {
        insp.diags.forEach((d) => addLog(`[${d.severity}] ${d.message}`));
      }
      addLog(
        `[信息] 检测到 ${insp.parts.length} 个部件, ${insp.pivotMap.size} 个 pivot`,
      );

      // Load into svgcanvas
      const result = adapter.loadSvg(svgText);
      setImportResult(result);
      addLog(`[信息] 导入完成: ${result.parts.length} 个语义部件`);
      if (result.diagnostics.length) {
        result.diagnostics.forEach((d) => addLog(`[${d.severity}] ${d.message}`));
      }

      // Default select first part
      if (result.parts.length > 0) {
        handleSelectPart(result.parts[0].partId);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`[错误] 载入失败: ${msg}`);
    }
  };

  const handleDispose = () => {
    stopAnimation();
    adapterRef.current?.dispose();
    adapterRef.current = null;
    setImportResult(null);
    setInspectResult(null);
    setSelectedPart(null);
    setPivotInfo(null);
    setCanvasVersion("");
    setCurrentFrame(0);
    setIsPlaying(false);
    addLog("[信息] 画布已销毁。");
  };

  const handleSelectPart = useCallback(
    (partId: string) => {
      const adapter = adapterRef.current;
      if (!adapter) return;

      // Restore previous part's bind pose
      if (selectedPart && selectedPart !== partId) {
        adapter.restoreBindPose(selectedPart);
      }

      stopAnimation();
      adapter.selectPart(partId);
      setSelectedPart(partId);
      setCurrentFrame(0);

      // Update pivot info
      if (inspectResult?.pivotMap.has(partId)) {
        setPivotInfo(inspectResult.pivotMap.get(partId)!);
      } else {
        setPivotInfo(null);
      }

      addLog(`[信息] 选中部件: ${partId}`);
    },
    [selectedPart, inspectResult],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Animation ----
  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setIsPlaying(false);
    frameTimeRef.current = 0;
    lastTimestampRef.current = 0;
  }, []);

  // Apply transform when frame or clip changes
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !selectedPart) return;
    if (clip.partId !== selectedPart) return;

    const motionKeyframes: MotionKeyframe[] = clip.keyframes.map((kf) => ({
      frame: kf.frame,
      values: { rotation: kf.rotation },
      easing: kf.easing === "easeInOut" ? "easeInOut" : "linear",
    }));

    const result = interpolateKeyframes(motionKeyframes, currentFrame);
    adapter.applyPreviewTransform(selectedPart, {
      x: result.x,
      y: result.y,
      rotation: result.rotation,
      scaleX: result.scaleX,
      scaleY: result.scaleY,
      opacity: result.opacity,
    });
  }, [currentFrame, clip, selectedPart]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const fps = clip.fps;
    const frameDuration = 1000 / fps;
    const totalFrames = clip.durationFrames;

    if (lastTimestampRef.current === 0) {
      lastTimestampRef.current = performance.now();
    }

    const animate = (timestamp: number) => {
      const delta = timestamp - lastTimestampRef.current;
      lastTimestampRef.current = timestamp;
      frameTimeRef.current += delta;

      let frame = Math.floor(frameTimeRef.current / frameDuration);
      if (frame >= totalFrames) {
        if (loopEnabled) {
          frameTimeRef.current = 0;
          frame = 0;
        } else {
          setCurrentFrame(totalFrames);
          setIsPlaying(false);
          return;
        }
      }
      setCurrentFrame(frame);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isPlaying, clip, loopEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAnimation();
      adapterRef.current?.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFrameSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPlaying) {
      setIsPlaying(false);
    }
    setCurrentFrame(Number(e.target.value));
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      frameTimeRef.current = currentFrame * (1000 / clip.fps);
      lastTimestampRef.current = 0;
      setIsPlaying(true);
    }
  };

  // ---- Export / Import ----
  const handleExport = () => {
    if (!fingerprint) {
      addLog("[错误] 请先加载素材");
      return;
    }
    const project: ExperimentalProject = {
      experimentalSchema: "m8-p0@1",
      productionReady: false,
      sourceFingerprint: fingerprint,
      clip,
    };
    const json = serializeProject(project);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${clip.id}.motion.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`[信息] 导出实验 JSON: ${clip.id}.motion.json`);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== "string") {
        addLog("[错误] 无法读取文件");
        return;
      }
      try {
        const project = parseProject(text);
        setClip(project.clip);
        setCurrentFrame(0);
        setIsPlaying(false);
        frameTimeRef.current = 0;
        addLog(
          `[信息] 导入实验 JSON: ${project.clip.id} (${project.clip.keyframes.length} 关键帧)`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`[错误] 导入失败: ${msg}`);
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    e.target.value = "";
  };

  // Clean up selected part when switching parts during animation
  useEffect(() => {
    return () => {
      if (adapterRef.current && selectedPart) {
        adapterRef.current.restoreBindPose(selectedPart);
      }
    };
  }, [selectedPart]);

  return (
    <div className="app">
      <header className="toolbar">
        <h1>小洛宝 Animation Studio — P0</h1>
        <div className="controls">
          <button onClick={handleInit} disabled={!!adapterRef.current}>
            初始化画布
          </button>
          <button
            onClick={handleLoadSample}
            disabled={!adapterRef.current || !svgUrl}
          >
            载入默认样例
          </button>
          <button onClick={handleDispose} disabled={!adapterRef.current}>
            销毁画布
          </button>
          <button onClick={handleExport} disabled={!fingerprint}>
            导出实验 JSON
          </button>
          <button onClick={() => fileInputRef.current?.click()}>
            导入实验 JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
        </div>
        {canvasVersion && (
          <span className="version">svgcanvas v{canvasVersion}</span>
        )}
        {fingerprint && (
          <span className="fingerprint">
            源指纹: sha256:{fingerprint.slice(0, 8)}...
          </span>
        )}
      </header>

      <main className="stage-area">
        <div ref={containerRef} className="canvas-container" />
      </main>

      <aside className="sidebar">
        {/* ---- P0-C: 部件列表 ---- */}
        {(importResult || inspectResult) && (
          <div className="parts-panel">
            <h2>部件</h2>
            <ul className="parts-list">
              {(importResult?.parts ?? inspectResult?.parts ?? []).map(
                (p: { partId: string }) => (
                  <li
                    key={p.partId}
                    className={`part-item ${selectedPart === p.partId ? "selected" : ""}`}
                    onClick={() => handleSelectPart(p.partId)}
                  >
                    {p.partId}
                    {inspectResult?.pivotMap.has(p.partId) && (
                      <span className="pivot-badge" title="有 pivot 标记">
                        ◎
                      </span>
                    )}
                  </li>
                ),
              )}
            </ul>

            {/* ---- P0-C: pivot 信息 ---- */}
            {selectedPart && pivotInfo && (
              <div className="pivot-info">
                <h3>Pivot 信息</h3>
                <p>
                  部件: {selectedPart}
                  <br />
                  坐标: ({pivotInfo.x.toFixed(2)}, {pivotInfo.y.toFixed(2)})
                  <br />
                  DOM id: {pivotInfo.sourceElementId}
                </p>
              </div>
            )}
            {selectedPart && !pivotInfo && (
              <div className="pivot-info">
                <h3>Pivot 信息</h3>
                <p className="placeholder">该部件无 pivot 标记</p>
              </div>
            )}
          </div>
        )}

        {/* ---- P0-D: 动作预览 ---- */}
        {selectedPart && (
          <div className="animation-panel">
            <h2>动作预览</h2>
            <div className="clip-info">
              <p>
                {clip.id} — {clip.partId}
                <br />
                {clip.fps} fps, {clip.durationFrames} 帧
                {clip.pivot.x !== 0 || clip.pivot.y !== 0
                  ? `, pivot (${clip.pivot.x}, ${clip.pivot.y})`
                  : ""}
              </p>
            </div>

            <div className="playback-controls">
              <button onClick={handleTogglePlay} className="play-btn">
                {isPlaying ? "⏸ 暂停" : "▶ 播放"}
              </button>
              <label className="loop-label">
                <input
                  type="checkbox"
                  checked={loopEnabled}
                  onChange={(e) => setLoopEnabled(e.target.checked)}
                />
                循环
              </label>
            </div>

            <div className="slider-row">
              <span className="frame-label">
                {currentFrame} / {clip.durationFrames}
              </span>
              <input
                type="range"
                min={0}
                max={clip.durationFrames}
                value={currentFrame}
                onChange={handleFrameSlider}
                className="frame-slider"
              />
            </div>

            {/* 关键帧标记 */}
            <div className="keyframe-markers">
              {clip.keyframes.map((kf) => (
                <span
                  key={kf.frame}
                  className="keyframe-dot"
                  title={`f${kf.frame}: rotation=${kf.rotation}° (${kf.easing})`}
                  style={{
                    left: `${(kf.frame / clip.durationFrames) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ---- 导入诊断 ---- */}
        <div className="diagnostics-section">
          <h2>导入诊断</h2>
          {importResult ? (
            <div className="diagnostics">
              <p>部件数: {importResult.parts.length}</p>
              <p>诊断数: {importResult.diagnostics.length}</p>
              <ul>
                {importResult.diagnostics.map(
                  (d: { severity: string; message: string }, i: number) => (
                    <li key={i} className={`diag-${d.severity}`}>
                      [{d.severity}] {d.message}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ) : (
            <p className="placeholder">尚未导入</p>
          )}
        </div>

        {/* ---- 日志 ---- */}
        <h2>日志</h2>
        <pre className="log">{log.join("\n") || "等待操作..."}</pre>
      </aside>
    </div>
  );
}
