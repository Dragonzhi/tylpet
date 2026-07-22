import { useCallback, useEffect, useRef, useState } from "react";
import { SvgCanvasAdapter } from "../svgcanvas/SvgCanvasAdapter";
import { formatError } from "../lib/errors";

export interface UseCanvasAdapterOptions {
  addLog: (message: string) => void;
  onPartSelected: (partId: string) => void;
}

export function useCanvasAdapter({ addLog, onPartSelected }: UseCanvasAdapterOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<SvgCanvasAdapter | null>(null);
  const [canvasVersion, setCanvasVersion] = useState("");
  const onPartSelectedRef = useRef(onPartSelected);
  onPartSelectedRef.current = onPartSelected;

  const handleInit = useCallback(() => {
    if (!containerRef.current || adapterRef.current) return;
    try {
      const adapter = new SvgCanvasAdapter();
      adapter.mount(containerRef.current);
      adapter.onPartSelected((partId) => {
        onPartSelectedRef.current(partId);
      });
      adapterRef.current = adapter;
      setCanvasVersion(adapter.getVersion());
      addLog(`[信息] svgcanvas v${adapter.getVersion()} 初始化完成`);
    } catch (error: unknown) {
      addLog(`[错误] 画布初始化失败：${formatError(error)}`);
    }
  }, [addLog]);

  useEffect(() => {
    handleInit();
  }, [handleInit]);

  // Unmount cleanup: dispose adapter only (rAF cleanup handled by usePlayback)
  useEffect(() => () => {
    adapterRef.current?.dispose();
    adapterRef.current = null;
  }, []);

  return { containerRef, adapterRef, canvasVersion };
}
