import type { ActionRequest } from "../actions/types";
import { actionRequiresConfirmation } from "./tools";
import type { AgentLimits, AgentPolicyDecision, AgentPolicyOptions } from "./types";

export class AgentActionPolicy {
  private readonly actionTimes: number[] = [];
  private readonly lastAllowedByType = new Map<ActionRequest["type"], number>();

  constructor(
    private readonly limits: AgentLimits,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  authorize(action: ActionRequest, options: AgentPolicyOptions): AgentPolicyDecision {
    if (!options.enabled) {
      return { allowed: false, errorCode: "permission_denied", reason: "Agent 总开关已关闭" };
    }
    if (actionRequiresConfirmation(action.type) && !options.confirmed) {
      return { allowed: false, errorCode: "confirmation_required", reason: "该动作需要用户逐次确认" };
    }

    const now = this.clock();
    while (this.actionTimes.length > 0 && now - this.actionTimes[0] >= 60_000) {
      this.actionTimes.shift();
    }
    if (this.actionTimes.length >= this.limits.maxActionsPerMinute) {
      return { allowed: false, errorCode: "rate_limit_exceeded", reason: "Agent 每分钟动作次数已达上限" };
    }

    const cooldownMs = this.limits.cooldownMs[action.type] ?? 0;
    const lastAllowed = this.lastAllowedByType.get(action.type);
    if (lastAllowed !== undefined && now - lastAllowed < cooldownMs) {
      return { allowed: false, errorCode: "cooldown_active", reason: "该动作仍在冷却中" };
    }

    this.actionTimes.push(now);
    this.lastAllowedByType.set(action.type, now);
    return { allowed: true };
  }
}
