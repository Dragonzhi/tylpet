import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "../settings/defaults";
import {
  BEHAVIOR_MODE_POLICIES,
  getBehaviorModePolicy,
  getEffectiveBehaviorCapabilities,
} from "./modePolicy";

describe("角色模式策略", () => {
  it("四种模式具有稳定且互不重复的标识", () => {
    expect(BEHAVIOR_MODE_POLICIES.map((item) => item.mode)).toEqual([
      "companion",
      "focus",
      "quiet",
      "sleep",
    ]);
  });

  it("专注模式降低环境反馈但保留 Agent、朗读和番茄钟策略", () => {
    const policy = getBehaviorModePolicy("focus");
    expect(policy.allowAgent).toBe(true);
    expect(policy.allowSpeech).toBe(true);
    expect(policy.allowObservations).toBe(true);
    expect(policy.observationIntensityMultiplier).toBeLessThan(1);
    expect(policy.observationCooldownMultiplier).toBeGreaterThan(1);
  });

  it("安静和休眠模式都暂停自主能力但不关闭计时器", () => {
    for (const mode of ["quiet", "sleep"] as const) {
      const settings = createDefaultSettings();
      settings.behavior.mode = mode;
      settings.agent.enabled = true;
      settings.speech.enabled = true;
      settings.observation.enabled = true;
      const capabilities = getEffectiveBehaviorCapabilities(settings);
      expect(capabilities).toEqual({
        companion: false,
        agent: false,
        speech: false,
        observations: false,
        timer: true,
      });
    }
  });

  it("用户总开关始终高于陪伴模式的允许策略", () => {
    const settings = createDefaultSettings();
    settings.behavior.mode = "companion";
    expect(getEffectiveBehaviorCapabilities(settings)).toEqual({
      companion: true,
      agent: false,
      speech: false,
      observations: false,
      timer: true,
    });
  });

  it("自主陪伴总开关与模式策略共同决定有效状态", () => {
    const settings = createDefaultSettings();
    expect(getEffectiveBehaviorCapabilities(settings).companion).toBe(true);
    settings.companion.autonomyEnabled = false;
    expect(getEffectiveBehaviorCapabilities(settings).companion).toBe(false);
    settings.companion.autonomyEnabled = true;
    settings.behavior.mode = "sleep";
    expect(getEffectiveBehaviorCapabilities(settings).companion).toBe(false);
  });
});
