import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SettingsStore } from "../controllers/SettingsStore";
import type { PetSettings } from "../domain/settings/types";
import { createDefaultSettings } from "../domain/settings/defaults";
import { hasSavedPosition } from "../domain/settings/validate";

/**
 * 设置管理 hook。
 *
 * 职责：
 * - 启动时加载设置并恢复窗口位置
 * - 提供 updateSettings 方法（自动防抖保存）
 * - 组件卸载时取消未完成的保存
 *
 * 返回的 settings 在加载完成前为 null，调用方应显示空白或 loading。
 */
export function useSettings() {
  const storeRef = useRef<SettingsStore | null>(null);
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [restored, setRestored] = useState(false);

  if (storeRef.current === null) {
    storeRef.current = new SettingsStore();
  }

  // 启动时加载设置并恢复窗口位置，然后显示窗口
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const loaded = await storeRef.current!.load();
      if (cancelled) return;

      const win = getCurrentWindow();

      // 恢复窗口位置；没有保存位置时居中
      if (hasSavedPosition(loaded)) {
        const restored = await storeRef.current!.restoreWindowPosition(loaded);
        if (cancelled) return;
        if (!restored) {
          try {
            await win.center();
          } catch {
            // 居中失败不影响启动
          }
        }
      } else {
        try {
          await win.center();
        } catch {
          // 居中失败不影响启动
        }
      }

      if (cancelled) return;

      // 位置恢复完成后再显示窗口，避免启动闪烁
      try {
        await win.show();
      } catch {
        // show 失败不影响后续逻辑
      }

      setSettings(loaded);
      setRestored(true);
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, []);

  // 卸载时取消未完成的保存
  useEffect(() => {
    return () => {
      storeRef.current?.dispose();
    };
  }, []);

  /**
   * 更新设置（浅合并）并防抖保存。
   */
  const updateSettings = useCallback(
    (partial: Partial<PetSettings>) => {
      setSettings((prev) => {
        const base = prev ?? createDefaultSettings();
        const next: PetSettings = {
          ...base,
          ...partial,
          window: { ...base.window, ...partial.window },
          animation: { ...base.animation, ...partial.animation },
          audio: { ...base.audio, ...partial.audio },
          agent: { ...base.agent, ...partial.agent },
        };
        storeRef.current?.saveDebounced(next);
        return next;
      });
    },
    [],
  );

  /**
   * 更新窗口位置并防抖保存。
   */
  const updateWindowPosition = useCallback(
    (x: number, y: number) => {
      updateSettings({ window: { x, y } } as Partial<PetSettings>);
    },
    [updateSettings],
  );

  /**
   * 立即保存当前设置（跳过防抖）。
   */
  const flushSave = useCallback(async () => {
    if (settings) {
      await storeRef.current?.saveImmediate(settings);
    }
  }, [settings]);

  return {
    settings,
    restored,
    updateSettings,
    updateWindowPosition,
    flushSave,
  };
}
