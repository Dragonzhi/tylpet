import { describe, expect, it } from "vitest";
import { sanitizeObservationDiagnostic, sanitizeSchedulerEvent } from "./sanitize";

describe("脱敏运行诊断", () => {
  it("调度事件不保留动作 ID、原因、payload 或工具参数", () => {
    const diagnostic = sanitizeSchedulerEvent({
      type: "failed",
      actionId: "secret-action-id",
      actionType: "speech.say",
      source: "agent",
      channel: "speech",
      priority: "agent",
      timestamp: 123,
      reason: "不应导出的完整朗读文本",
      errorCode: "speech_failed",
    });
    expect(diagnostic).toEqual({
      timestamp: 123,
      actionType: "speech.say",
      source: "agent",
      channel: "speech",
      priority: "agent",
      outcome: "failed",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret-action-id");
    expect(JSON.stringify(diagnostic)).not.toContain("完整朗读文本");
  });

  it("观察诊断不保留来源 ID、事件 ID 和拒绝原因", () => {
    const diagnostic = sanitizeObservationDiagnostic({
      receivedAt: 456,
      eventId: "private-event",
      sourceKind: "plugin",
      sourceId: "private-plugin-id",
      eventType: "dev-agent.status",
      outcome: "rejected",
      code: "rate_limited",
      reason: "不应导出的原始原因",
    });
    expect(diagnostic).toEqual({
      receivedAt: 456,
      sourceKind: "plugin",
      eventType: "dev-agent.status",
      outcome: "rejected",
      code: "rate_limited",
    });
  });
});
