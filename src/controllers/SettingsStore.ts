import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { PetSettings } from "../domain/settings/types";
import {
  parseSettings,
  serializeSettings,
  hasSavedPosition,
} from "../domain/settings/validate";
import { createDefaultSettings } from "../domain/settings/defaults";
import { clampToWorkArea, type Rect, type Size } from "../motion/windowMoveMath";
import { WINDOW_MOVE_CONFIG } from "../config/windowMove";

interface WorkAreaResponse {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 设置存储适配层。
 *
 * 职责：
 * - 加载/保存设置到原生持久化层（Tauri 命令）
 * - 防抖写入，避免高频调用
 * - 位置恢复时校正到可用工作区
 *
 * 不负责 React 状态管理，调用方自行决定何时加载和保存。
 */
export class SettingsStore {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingSettings: PetSettings | null = null;
  private saveDebounceMs: number;

  constructor(options?: { saveDebounceMs?: number }) {
    this.saveDebounceMs = options?.saveDebounceMs ?? 1000;
  }

  /**
   * 加载设置。文件不存在或损坏时返回默认设置。
   */
  async load(): Promise<PetSettings> {
    try {
      const json = await invoke<string | null>("load_settings");
      if (json === null || json === undefined) {
        return createDefaultSettings();
      }
      const result = parseSettings(json);
      if (result.ok) {
        return result.settings;
      }
      // 损坏文件：记录诊断信息，返回默认值
      console.warn(`设置文件损坏: ${result.reason}，使用默认设置`);
      return createDefaultSettings();
    } catch (error) {
      console.error("加载设置失败:", error);
      return createDefaultSettings();
    }
  }

  /**
   * 立即保存设置（跳过防抖）。
   */
  async saveImmediate(settings: PetSettings): Promise<void> {
    this.cancelPendingSave();
    try {
      const json = serializeSettings(settings);
      await invoke("save_settings", { json });
    } catch (error) {
      console.error("保存设置失败:", error);
    }
  }

  /**
   * 防抖保存设置。多次调用只会在最后一次调用后等待 debounceMs 再写入。
   */
  saveDebounced(settings: PetSettings): void {
    this.pendingSettings = settings;
    this.cancelPendingSave();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      if (this.pendingSettings) {
        void this.saveImmediate(this.pendingSettings);
        this.pendingSettings = null;
      }
    }, this.saveDebounceMs);
  }

  /**
   * 恢复窗口位置，校正到可用工作区。
   *
   * 如果设置中没有保存位置（NaN），调用方应自行决定回退（如居中）。
   * 返回 true 表示位置已恢复，false 表示需要回退。
   */
  async restoreWindowPosition(settings: PetSettings): Promise<boolean> {
    if (!hasSavedPosition(settings)) {
      return false;
    }

    try {
      const win = getCurrentWindow();
      const winSize = await win.outerSize();
      const winSizeObj: Size = {
        width: winSize.width,
        height: winSize.height,
      };

      const workArea = await this.getWorkArea();
      if (!workArea) {
        // 无法获取工作区，直接使用保存的坐标
        await win.setPosition(
          new PhysicalPosition(
            Math.round(settings.window.x),
            Math.round(settings.window.y),
          ),
        );
        return true;
      }

      // 校正到工作区内
      const clamped = clampToWorkArea(
        { x: settings.window.x, y: settings.window.y },
        workArea,
        winSizeObj,
        WINDOW_MOVE_CONFIG.boundaryMarginPx,
      );

      await win.setPosition(
        new PhysicalPosition(Math.round(clamped.x), Math.round(clamped.y)),
      );
      return true;
    } catch (error) {
      console.error("恢复窗口位置失败:", error);
      return false;
    }
  }

  /**
   * 取消尚未执行的防抖保存。
   */
  cancelPendingSave(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  /**
   * 释放资源，取消未完成的保存。
   */
  dispose(): void {
    this.cancelPendingSave();
    this.pendingSettings = null;
  }

  private async getWorkArea(): Promise<Rect | null> {
    try {
      const area = await invoke<WorkAreaResponse>("get_work_area");
      return { x: area.x, y: area.y, width: area.width, height: area.height };
    } catch {
      try {
        const monitor = await currentMonitor();
        if (!monitor) return null;
        return {
          x: monitor.position.x,
          y: monitor.position.y,
          width: monitor.size.width,
          height: monitor.size.height,
        };
      } catch {
        return null;
      }
    }
  }
}
