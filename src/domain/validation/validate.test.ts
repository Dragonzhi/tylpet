import { describe, expect, it } from "vitest";
import { validateActionRequest } from "./validate";

describe("合法输入通过校验", () => {
  it("合法的 motion.play 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 expression.set 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "expression.set",
      source: "dev",
      requestedAt: 1000,
      payload: { expression: "happy" },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 look.set 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "look.set",
      source: "dev",
      requestedAt: 1000,
      payload: { x: 0.5, y: -0.3 },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 window.move 语义目标通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "window.move",
      source: "dev",
      requestedAt: 1000,
      payload: { target: { kind: "semantic", position: "center" } },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 window.move 归一化目标通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "window.move",
      source: "dev",
      requestedAt: 1000,
      payload: { target: { kind: "normalized", x: 0.5, y: 0.5 } },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 outfit.equip 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "outfit.equip",
      source: "dev",
      requestedAt: 1000,
      payload: { outfitId: "dress-red" },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 speech.say 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "speech.say",
      source: "dev",
      requestedAt: 1000,
      payload: { text: "你好" },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 timer.start 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "timer.start",
      source: "dev",
      requestedAt: 1000,
      payload: { durationMs: 5000 },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 timer.pause 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "timer.pause",
      source: "dev",
      requestedAt: 1000,
      payload: { timerId: "timer-1" },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 timer.cancel 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "timer.cancel",
      source: "dev",
      requestedAt: 1000,
      payload: { timerId: "timer-1" },
    });
    expect(result.ok).toBe(true);
  });

  it("合法的 wait 通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "wait",
      source: "dev",
      requestedAt: 1000,
      payload: { durationMs: 1000 },
    });
    expect(result.ok).toBe(true);
  });

  it("带可选字段的请求通过校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      timeoutMs: 5000,
      correlationId: "corr-1",
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(true);
  });

  it("motion.play 缺省 speed 时默认为 1", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action.payload).toHaveProperty("speed", 1);
    }
  });

  it("speech.say 缺省 interrupt 时默认为 true", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "speech.say",
      source: "dev",
      requestedAt: 1000,
      payload: { text: "hello" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action.payload).toHaveProperty("interrupt", true);
    }
  });

  it("window.move 缺省 durationMs 时默认为 1000", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "window.move",
      source: "dev",
      requestedAt: 1000,
      payload: { target: { kind: "semantic", position: "center" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action.payload).toHaveProperty("durationMs", 1000);
    }
  });
});

describe("缺字段被拒绝", () => {
  it("缺少 id 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("invalid_payload");
    }
  });

  it("缺少 type 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });

  it("缺少 payload 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
    });
    expect(result.ok).toBe(false);
  });

  it("缺少 source 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });

  it("缺少 requestedAt 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("未知动作与版本被拒绝", () => {
  it("未知动作类型被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "unknown.action",
      source: "dev",
      requestedAt: 1000,
      payload: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("invalid_payload");
    }
  });

  it("未知协议版本被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 2,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });

  it("缺少协议版本被拒绝", () => {
    const result = validateActionRequest({
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("越界输入被拒绝", () => {
  it("look.set x 大于 1 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "look.set",
      source: "dev",
      requestedAt: 1000,
      payload: { x: 1.5, y: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("look.set x 小于 -1 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "look.set",
      source: "dev",
      requestedAt: 1000,
      payload: { x: -1.5, y: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("look.set y 大于 1 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "look.set",
      source: "dev",
      requestedAt: 1000,
      payload: { x: 0, y: 2 },
    });
    expect(result.ok).toBe(false);
  });

  it("window.move 归一化 x 大于 1 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "window.move",
      source: "dev",
      requestedAt: 1000,
      payload: { target: { kind: "normalized", x: 1.1, y: 0.5 } },
    });
    expect(result.ok).toBe(false);
  });

  it("window.move 归一化 x 小于 0 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "window.move",
      source: "dev",
      requestedAt: 1000,
      payload: { target: { kind: "normalized", x: -0.1, y: 0.5 } },
    });
    expect(result.ok).toBe(false);
  });

  it("timer.start durationMs 小于等于 0 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "timer.start",
      source: "dev",
      requestedAt: 1000,
      payload: { durationMs: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("timer.start durationMs 超过 24 小时被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "timer.start",
      source: "dev",
      requestedAt: 1000,
      payload: { durationMs: 86400001 },
    });
    expect(result.ok).toBe(false);
  });

  it("wait durationMs 超过 60000 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "wait",
      source: "dev",
      requestedAt: 1000,
      payload: { durationMs: 60001 },
    });
    expect(result.ok).toBe(false);
  });

  it("wait durationMs 小于 0 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "wait",
      source: "dev",
      requestedAt: 1000,
      payload: { durationMs: -1 },
    });
    expect(result.ok).toBe(false);
  });
});

describe("NaN 与无穷值被拒绝", () => {
  it("look.set x 为 NaN 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "look.set",
      source: "dev",
      requestedAt: 1000,
      payload: { x: NaN, y: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("look.set x 为 Infinity 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "look.set",
      source: "dev",
      requestedAt: 1000,
      payload: { x: Infinity, y: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("look.set x 为 -Infinity 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "look.set",
      source: "dev",
      requestedAt: 1000,
      payload: { x: -Infinity, y: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("timer.start durationMs 为 NaN 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "timer.start",
      source: "dev",
      requestedAt: 1000,
      payload: { durationMs: NaN },
    });
    expect(result.ok).toBe(false);
  });

  it("requestedAt 为 NaN 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: NaN,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("字符串约束", () => {
  it("motion.play 空动作名被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("motion.play 动作名超过 64 字符被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "a".repeat(65) },
    });
    expect(result.ok).toBe(false);
  });

  it("expression.set 空表情名被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "expression.set",
      source: "dev",
      requestedAt: 1000,
      payload: { expression: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("outfit.equip 空服装 ID 被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "outfit.equip",
      source: "dev",
      requestedAt: 1000,
      payload: { outfitId: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("speech.say 空文本被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "speech.say",
      source: "dev",
      requestedAt: 1000,
      payload: { text: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("speech.say 文本超过 500 字符被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "speech.say",
      source: "dev",
      requestedAt: 1000,
      payload: { text: "a".repeat(501) },
    });
    expect(result.ok).toBe(false);
  });

  it("id 超过 128 字符被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "a".repeat(129),
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("类型错误被拒绝", () => {
  it("payload 不是对象被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: 123,
    });
    expect(result.ok).toBe(false);
  });

  it("type 不是字符串被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: 123,
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });

  it("source 不是合法来源被拒绝", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "hack",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(false);
  });

  it("输入不是对象被拒绝", () => {
    const result = validateActionRequest("hello");
    expect(result.ok).toBe(false);
  });

  it("输入为 null 被拒绝", () => {
    const result = validateActionRequest(null);
    expect(result.ok).toBe(false);
  });
});

describe("能力检查", () => {
  it("渲染器不支持的 motion 返回 unsupported_action", () => {
    const result = validateActionRequest(
      {
        protocolVersion: 1,
        id: "test-1",
        type: "motion.play",
        source: "dev",
        requestedAt: 1000,
        payload: { motion: "wave" },
      },
      {
        capabilities: {
          renderer: {
            motions: ["blink"] as readonly string[],
            expressions: [] as readonly string[],
            lookDirection: false,
            outfits: [] as readonly string[],
          },
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("unsupported_action");
    }
  });

  it("渲染器不支持的 expression 返回 unsupported_action", () => {
    const result = validateActionRequest(
      {
        protocolVersion: 1,
        id: "test-1",
        type: "expression.set",
        source: "dev",
        requestedAt: 1000,
        payload: { expression: "happy" },
      },
      {
        capabilities: {
          renderer: {
            motions: [] as readonly string[],
            expressions: ["sad"] as readonly string[],
            lookDirection: false,
            outfits: [] as readonly string[],
          },
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("unsupported_action");
    }
  });

  it("look.set 在 lookDirection 为 false 时返回 unsupported_action", () => {
    const result = validateActionRequest(
      {
        protocolVersion: 1,
        id: "test-1",
        type: "look.set",
        source: "dev",
        requestedAt: 1000,
        payload: { x: 0.5, y: 0 },
      },
      {
        capabilities: {
          renderer: {
            motions: [] as readonly string[],
            expressions: [] as readonly string[],
            lookDirection: false,
            outfits: [] as readonly string[],
          },
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("unsupported_action");
    }
  });

  it("window.move 在无 window 能力时返回 unsupported_action", () => {
    const result = validateActionRequest(
      {
        protocolVersion: 1,
        id: "test-1",
        type: "window.move",
        source: "dev",
        requestedAt: 1000,
        payload: { target: { kind: "semantic", position: "center" } },
      },
      { capabilities: {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("unsupported_action");
    }
  });

  it("speech.say 在无 speech 能力时返回 unsupported_action", () => {
    const result = validateActionRequest(
      {
        protocolVersion: 1,
        id: "test-1",
        type: "speech.say",
        source: "dev",
        requestedAt: 1000,
        payload: { text: "hello" },
      },
      { capabilities: {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("unsupported_action");
    }
  });

  it("timer.start 在无 timer 能力时返回 unsupported_action", () => {
    const result = validateActionRequest(
      {
        protocolVersion: 1,
        id: "test-1",
        type: "timer.start",
        source: "dev",
        requestedAt: 1000,
        payload: { durationMs: 5000 },
      },
      { capabilities: {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("unsupported_action");
    }
  });

  it("wait 在任何能力下都通过", () => {
    const result = validateActionRequest(
      {
        protocolVersion: 1,
        id: "test-1",
        type: "wait",
        source: "dev",
        requestedAt: 1000,
        payload: { durationMs: 1000 },
      },
      { capabilities: {} },
    );
    expect(result.ok).toBe(true);
  });

  it("未提供能力集时只做结构校验", () => {
    const result = validateActionRequest({
      protocolVersion: 1,
      id: "test-1",
      type: "motion.play",
      source: "dev",
      requestedAt: 1000,
      payload: { motion: "wave" },
    });
    expect(result.ok).toBe(true);
  });
});
