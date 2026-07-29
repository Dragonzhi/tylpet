import { PROTOCOL_VERSION, type ActionRequest } from "../actions/types";
import type { CapabilitySet } from "../capabilities/capabilities";
import type { BehaviorScheduler } from "../scheduler/scheduler";
import { getDefaultChannel } from "../scheduler/channelPolicy";
import { validateActionRequest } from "../validation/validate";
import { ObservationPolicy } from "./policy";
import { mapObservationToReaction } from "./reactionMap";
import type {
  ObservationDiagnostic,
  ObservationIngestResult,
  ObservationLimits,
  ObservationReaction,
  ObservationRuntimeConfig,
} from "./types";
import { validateObservationEvent } from "./validate";

export interface ObservationHostOptions {
  scheduler: BehaviorScheduler;
  getCapabilities(): CapabilitySet;
  limits: ObservationLimits;
  clock?: () => number;
  createId?: () => string;
  mapReaction?: typeof mapObservationToReaction;
}

export class ObservationHost {
  private readonly clock: () => number;
  private readonly createId: () => string;
  private readonly policy: ObservationPolicy;
  private readonly mapReaction: (event: Parameters<typeof mapObservationToReaction>[0], capabilities: CapabilitySet) => ObservationReaction | null;
  private config: ObservationRuntimeConfig = { enabled: false, diagnosticsEnabled: true, grants: [] };
  private diagnostics: ObservationDiagnostic[] = [];

  constructor(private readonly options: ObservationHostOptions) {
    this.clock = options.clock ?? (() => Date.now());
    this.createId = options.createId ?? defaultId;
    this.policy = new ObservationPolicy(options.limits, this.clock);
    this.mapReaction = options.mapReaction ?? mapObservationToReaction;
  }

  configure(config: ObservationRuntimeConfig): void {
    this.config = {
      enabled: config.enabled,
      diagnosticsEnabled: config.diagnosticsEnabled,
      grants: [...config.grants],
      cooldownMultiplier: normalizeCooldownMultiplier(config.cooldownMultiplier),
      ...(config.quietHours === undefined ? {} : { quietHours: { ...config.quietHours } }),
    };
    if (!config.diagnosticsEnabled) this.diagnostics = [];
  }

  ingest(input: unknown): ObservationIngestResult {
    const validation = validateObservationEvent(input, {
      maxPayloadBytes: this.options.limits.maxPayloadBytes,
    });
    if (!validation.ok) {
      const result: ObservationIngestResult = {
        status: "rejected",
        code: validation.code,
        reason: validation.reason,
      };
      this.recordUnknown(result);
      return result;
    }
    const event = validation.event;
    const decision = this.policy.authorize(event, this.config);
    if (!decision.allowed) {
      const result: ObservationIngestResult = {
        status: "rejected",
        eventId: event.id,
        code: decision.code,
        reason: decision.reason,
      };
      this.record(event, result);
      return result;
    }

    const capabilities = this.options.getCapabilities();
    const reaction = this.mapReaction(event, capabilities);
    if (!reaction) {
      const result: ObservationIngestResult = {
        status: "ignored",
        eventId: event.id,
        reason: "当前事件没有可用且低打扰的角色反应",
      };
      this.record(event, result);
      return result;
    }
    const action = this.createAction(event.id, event.correlationId, reaction, capabilities);
    if (!action) {
      const result: ObservationIngestResult = {
        status: "rejected",
        eventId: event.id,
        code: "unsupported_reaction",
        reason: "反应动作未通过当前能力或参数校验",
      };
      this.record(event, result);
      return result;
    }
    const channel = getDefaultChannel(action.type);
    if (!channel) {
      const result: ObservationIngestResult = {
        status: "rejected",
        eventId: event.id,
        code: "unsupported_reaction",
        reason: "反应动作没有可用调度通道",
      };
      this.record(event, result);
      return result;
    }
    this.options.scheduler.submit(action, {
      channel,
      priority: "agent",
      cooldownMs: reaction.cooldownMs * normalizeCooldownMultiplier(this.config.cooldownMultiplier),
    });
    const result: ObservationIngestResult = { status: "scheduled", eventId: event.id, action };
    this.record(event, result);
    return result;
  }

  getDiagnostics(): readonly ObservationDiagnostic[] {
    return [...this.diagnostics];
  }

  clearDiagnostics(): void {
    this.diagnostics = [];
  }

  reset(): void {
    this.policy.reset();
    this.diagnostics = [];
  }

  private createAction(
    eventId: string,
    correlationId: string | undefined,
    reaction: ObservationReaction,
    capabilities: CapabilitySet,
  ): ActionRequest | null {
    const raw = {
      protocolVersion: PROTOCOL_VERSION,
      id: this.createId(),
      type: reaction.type,
      payload: reaction.payload,
      source: "system",
      requestedAt: this.clock(),
      timeoutMs: 10_000,
      correlationId: correlationId ?? eventId,
    };
    const validation = validateActionRequest(raw, { capabilities });
    return validation.ok ? validation.action : null;
  }

  private record(event: Parameters<typeof mapObservationToReaction>[0], result: ObservationIngestResult): void {
    if (!this.config.diagnosticsEnabled) return;
    this.pushDiagnostic({
      receivedAt: this.clock(),
      eventId: event.id,
      sourceKind: event.source.kind,
      sourceId: event.source.id,
      eventType: event.type,
      outcome: result.status,
      ...(result.status === "scheduled" ? { actionType: result.action.type } : {}),
      ...(result.status === "rejected" ? { code: result.code, reason: result.reason } : {}),
      ...(result.status === "ignored" ? { reason: result.reason } : {}),
    });
  }

  private recordUnknown(result: Extract<ObservationIngestResult, { status: "rejected" }>): void {
    if (!this.config.diagnosticsEnabled) return;
    this.pushDiagnostic({
      receivedAt: this.clock(),
      eventId: "invalid",
      sourceKind: "unknown",
      sourceId: "unknown",
      eventType: "unknown",
      outcome: "rejected",
      code: result.code,
      reason: result.reason,
    });
  }

  private pushDiagnostic(entry: ObservationDiagnostic): void {
    this.diagnostics.push(entry);
    const excess = this.diagnostics.length - this.options.limits.diagnosticCapacity;
    if (excess > 0) this.diagnostics.splice(0, excess);
  }
}

function normalizeCooldownMultiplier(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? value : 1;
}

function defaultId(): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `observation-action-${suffix}`;
}
