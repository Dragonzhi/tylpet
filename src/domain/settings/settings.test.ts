import { describe, it, expect } from "vitest";
import {
  parseSettings,
  serializeSettings,
  hasSavedPosition,
  CURRENT_SCHEMA_VERSION,
} from "./validate";
import { createDefaultSettings } from "./defaults";
import { migrate } from "./migrate";
import type { PetSettings } from "./types";

describe("settings domain", () => {
  describe("createDefaultSettings", () => {
    it("返回当前版本号", () => {
      const settings = createDefaultSettings();
      expect(settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("窗口位置默认为 NaN（未保存）", () => {
      const settings = createDefaultSettings();
      expect(Number.isNaN(settings.window.x)).toBe(true);
      expect(Number.isNaN(settings.window.y)).toBe(true);
    });

    it("默认启用置顶和穿透", () => {
      const settings = createDefaultSettings();
      expect(settings.window.alwaysOnTop).toBe(true);
      expect(settings.window.clickThrough).toBe(true);
    });

    it("默认动作强度为 1", () => {
      const settings = createDefaultSettings();
      expect(settings.animation.intensity).toBe(1);
    });

    it("默认启用声音，音量 0.8", () => {
      const settings = createDefaultSettings();
      expect(settings.audio.enabled).toBe(true);
      expect(settings.audio.volume).toBe(0.8);
    });

    it("默认关闭 Agent", () => {
      const settings = createDefaultSettings();
      expect(settings.agent.enabled).toBe(false);
    });
  });

  describe("parseSettings — 合法输入", () => {
    it("解析完整的 JSON 字符串", () => {
      const json = JSON.stringify({
        schemaVersion: 1,
        window: { x: 100, y: 200, alwaysOnTop: false, clickThrough: false },
        animation: { intensity: 0.5 },
        audio: { enabled: false, volume: 0.3 },
        agent: { enabled: true },
      });
      const result = parseSettings(json);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.window.x).toBe(100);
        expect(result.settings.window.alwaysOnTop).toBe(false);
        expect(result.settings.animation.intensity).toBe(0.5);
        expect(result.settings.agent.enabled).toBe(true);
      }
    });

    it("解析对象输入（非字符串）", () => {
      const obj = createDefaultSettings();
      const result = parseSettings(obj);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      }
    });

    it("补全缺失的字段", () => {
      const json = JSON.stringify({
        schemaVersion: 1,
        window: { x: 50, y: 60 },
      });
      const result = parseSettings(json);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.window.x).toBe(50);
        expect(result.settings.window.y).toBe(60);
        // 缺失字段使用默认值
        expect(result.settings.window.alwaysOnTop).toBe(true);
        expect(result.settings.animation.intensity).toBe(1);
        expect(result.settings.audio.enabled).toBe(true);
        expect(result.settings.agent.enabled).toBe(false);
      }
    });

    it("接受 NaN 窗口位置", () => {
      const json = JSON.stringify({
        schemaVersion: 1,
        window: { x: null, y: null },
      });
      const result = parseSettings(json);
      // null 不是 number，所以会用默认值 NaN
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Number.isNaN(result.settings.window.x)).toBe(true);
      }
    });
  });

  describe("parseSettings — 非法输入", () => {
    it("损坏的 JSON 返回 invalid_json", () => {
      const result = parseSettings("{not valid json}");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_json");
      }
    });

    it("null 输入返回 invalid_structure", () => {
      const result = parseSettings(null);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_structure");
      }
    });

    it("非对象输入返回 invalid_structure", () => {
      const result = parseSettings(42);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_structure");
      }
    });

    it("intensity 超出范围返回错误", () => {
      const json = JSON.stringify({
        schemaVersion: 1,
        animation: { intensity: 1.5 },
      });
      const result = parseSettings(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_structure");
        expect(result.reason).toContain("intensity");
      }
    });

    it("intensity 为负数返回错误", () => {
      const json = JSON.stringify({
        schemaVersion: 1,
        animation: { intensity: -0.1 },
      });
      const result = parseSettings(json);
      expect(result.ok).toBe(false);
    });

    it("volume 超出范围返回错误", () => {
      const json = JSON.stringify({
        schemaVersion: 1,
        audio: { volume: 2 },
      });
      const result = parseSettings(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("volume");
      }
    });

    it("schemaVersion 非数字返回错误", () => {
      const result = parseSettings({ schemaVersion: "abc" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_structure");
      }
    });
  });

  describe("migrate", () => {
    it("null 输入返回默认设置", () => {
      const settings = migrate(null);
      expect(settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(settings.audio.enabled).toBe(true);
    });

    it("无版本号的对象返回默认设置", () => {
      const settings = migrate({ window: { x: 10 } });
      expect(settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      // 默认设置，不保留输入
      expect(Number.isNaN(settings.window.x)).toBe(true);
    });

    it("未来版本返回默认设置（降级保护）", () => {
      const settings = migrate({ schemaVersion: 999 });
      expect(settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("当前版本补全缺失字段", () => {
      const settings = migrate({
        schemaVersion: 1,
        window: { x: 100, y: 200 },
      });
      expect(settings.window.x).toBe(100);
      expect(settings.window.y).toBe(200);
      expect(settings.window.alwaysOnTop).toBe(true); // 默认值
      expect(settings.agent.enabled).toBe(false); // 默认值
    });
  });

  describe("serializeSettings", () => {
    it("序列化为合法 JSON", () => {
      const settings = createDefaultSettings();
      const json = serializeSettings(settings);
      const parsed = JSON.parse(json);
      expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it("序列化包含所有字段", () => {
      const settings: PetSettings = {
        schemaVersion: 1,
        window: { x: 100, y: 200, alwaysOnTop: false, clickThrough: true },
        animation: { intensity: 0.7 },
        audio: { enabled: false, volume: 0.5 },
        agent: { enabled: true },
      };
      const json = serializeSettings(settings);
      const parsed = JSON.parse(json);
      expect(parsed.window.x).toBe(100);
      expect(parsed.window.alwaysOnTop).toBe(false);
      expect(parsed.animation.intensity).toBe(0.7);
      expect(parsed.agent.enabled).toBe(true);
    });

    it("序列化后解析应得到相同数据", () => {
      const original = createDefaultSettings();
      original.window.x = 500;
      original.window.y = 300;
      original.agent.enabled = true;
      const json = serializeSettings(original);
      const result = parseSettings(json);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.settings.window.x).toBe(500);
        expect(result.settings.agent.enabled).toBe(true);
      }
    });
  });

  describe("hasSavedPosition", () => {
    it("NaN 位置返回 false", () => {
      const settings = createDefaultSettings();
      expect(hasSavedPosition(settings)).toBe(false);
    });

    it("有效位置返回 true", () => {
      const settings = createDefaultSettings();
      settings.window.x = 100;
      settings.window.y = 200;
      expect(hasSavedPosition(settings)).toBe(true);
    });

    it("只有 x 是 NaN 时返回 false", () => {
      const settings = createDefaultSettings();
      settings.window.y = 200;
      expect(hasSavedPosition(settings)).toBe(false);
    });
  });
});
