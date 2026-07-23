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
      expect(settings.agent.provider).toBe("mock");
      expect(settings.agent.externalDataConsent).toBe(false);
      expect(settings.agent.allowInsecureHttp).toBe(false);
    });

    it("本地语音和自动朗读默认关闭", () => {
      const settings = createDefaultSettings();
      expect(settings.speech).toEqual({
        enabled: false,
        autoReadReplies: false,
        rate: 1,
        pitch: 1,
        voiceUri: "",
      });
    });

    it("番茄钟默认使用 25 分钟专注和 5 分钟休息", () => {
      const settings = createDefaultSettings();
      expect(settings.pomodoro).toEqual({
        focusMinutes: 25,
        breakMinutes: 5,
        showSystemReminder: true,
        soundEnabled: true,
      });
    });

    it("外部状态反馈默认关闭且诊断记录默认启用", () => {
      const settings = createDefaultSettings();
      expect(settings.observation).toEqual({
        enabled: false,
        systemMediaEnabled: false,
        musicReactionIntensity: 0.55,
        diagnosticsEnabled: true,
        quietHoursEnabled: false,
        quietHoursStartMinute: 1_320,
        quietHoursEndMinute: 480,
      });
    });

    it("默认处于无记忆模式，启用后使用逐次确认提议策略", () => {
      expect(createDefaultSettings().memory).toEqual({
        enabled: false,
        includeInModelContext: false,
        bondEnabled: false,
        proposalMode: "confirm",
      });
    });
  });

  describe("parseSettings — 合法输入", () => {
    it("解析完整的 JSON 字符串", () => {
      const json = JSON.stringify({
        schemaVersion: 2,
        window: { x: 100, y: 200, alwaysOnTop: false, clickThrough: false },
        animation: { intensity: 0.5 },
        audio: { enabled: false, volume: 0.3 },
        agent: { enabled: true },
        pomodoro: {
          focusMinutes: 25,
          breakMinutes: 5,
          showSystemReminder: true,
          soundEnabled: true,
        },
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

    it("番茄钟分钟数必须是 1 到 180 的整数", () => {
      const result = parseSettings({
        ...createDefaultSettings(),
        pomodoro: {
          ...createDefaultSettings().pomodoro,
          focusMinutes: 0,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("focusMinutes");
    });

    it("从 schema v1 迁移时保留旧设置并补充番茄钟", () => {
      const settings = migrate({
        schemaVersion: 1,
        window: { x: 100, y: 200, alwaysOnTop: false },
      });
      expect(settings.schemaVersion).toBe(9);
      expect(settings.window.alwaysOnTop).toBe(false);
      expect(settings.pomodoro.focusMinutes).toBe(25);
      expect(settings.agent.provider).toBe("mock");
      expect(settings.agent.maxContextChars).toBe(24_000);
      expect(settings.observation.enabled).toBe(false);
      expect(settings.speech.enabled).toBe(false);
      expect(settings.memory.enabled).toBe(false);
      expect(settings.memory.proposalMode).toBe("confirm");
    });

    it("从 schema v8 迁移时为已有长期体验补上安全的确认策略", () => {
      const settings = migrate({
        schemaVersion: 8,
        memory: { enabled: true, includeInModelContext: true, bondEnabled: true },
      });
      expect(settings.schemaVersion).toBe(9);
      expect(settings.memory).toEqual({
        enabled: true,
        includeInModelContext: true,
        bondEnabled: true,
        proposalMode: "confirm",
      });
    });

    it("拒绝超出范围的对话超时和重试设置", () => {
      const invalidTimeout = createDefaultSettings();
      invalidTimeout.agent.timeoutMs = 2_999;
      const timeoutResult = parseSettings(invalidTimeout);
      expect(timeoutResult.ok).toBe(false);

      const invalidRetries = createDefaultSettings();
      invalidRetries.agent.maxRetries = 3;
      const retryResult = parseSettings(invalidRetries);
      expect(retryResult.ok).toBe(false);
    });

    it("拒绝越界的安静时段分钟数", () => {
      const settings = createDefaultSettings();
      const result = parseSettings({
        ...settings,
        observation: { ...settings.observation, quietHoursStartMinute: 1_440 },
      });
      expect(result).toMatchObject({ ok: false, code: "invalid_structure" });
    });

    it("拒绝越界的系统音乐反应强度", () => {
      const settings = createDefaultSettings();
      const result = parseSettings({
        ...settings,
        observation: { ...settings.observation, musicReactionIntensity: 1.01 },
      });
      expect(result).toMatchObject({ ok: false, code: "invalid_structure" });
    });

    it("拒绝越界的语速和音高", () => {
      const settings = createDefaultSettings();
      expect(parseSettings({
        ...settings,
        speech: { ...settings.speech, rate: 2.01 },
      }).ok).toBe(false);
      expect(parseSettings({
        ...settings,
        speech: { ...settings.speech, pitch: 0.49 },
      }).ok).toBe(false);
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
      const settings: PetSettings = createDefaultSettings();
      settings.window = { x: 100, y: 200, alwaysOnTop: false, clickThrough: true };
      settings.animation.intensity = 0.7;
      settings.audio = { enabled: false, volume: 0.5 };
      settings.agent.enabled = true;
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
