import type { AgentLimits } from "../domain/agent/types";

/**
 * M12 Agent 的本地硬限制。它们不交给模型决定，也不由提示词覆盖。
 * maxModelCalls 同时限制一次用户消息可能产生的外部请求次数，防止工具循环扩大费用。
 */
export const AGENT_LIMITS: AgentLimits = {
  maxModelCalls: 5,
  maxToolSteps: 4,
  maxToolCallsPerStep: 3,
  maxOutputChars: 12_000,
  maxTurnMs: 90_000,
  maxConfirmationWaitMs: 300_000,
  maxActionsPerMinute: 8,
  cooldownMs: {
    "motion.play": 2_000,
    "expression.set": 1_000,
    "look.set": 500,
    "window.move": 15_000,
    "timer.start": 2_000,
    "timer.pause": 1_000,
    "timer.resume": 1_000,
    "timer.cancel": 1_000,
  },
};
