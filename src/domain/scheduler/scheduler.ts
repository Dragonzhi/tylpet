import type { ActionRequest, ActionResult, ActionType } from "../actions/types";
import type {
  ActionExecutor,
  ActiveAction,
  Channel,
  InternalActiveAction,
  PendingAction,
  Priority,
  SchedulerEvent,
  SchedulerEventType,
  SchedulerOptions,
  SubmitOptions,
} from "./types";
import { comparePriority, getDefaultPriority, getMutexGroup, shouldPreempt } from "./channelPolicy";

interface ActiveActionRecord extends InternalActiveAction {
  cooldownMs?: number;
}

export class BehaviorScheduler {
  private readonly clock: () => number;
  private readonly executor?: ActionExecutor;

  private activeActions = new Map<string, ActiveActionRecord>();
  private pendingQueue: PendingAction[] = [];
  private waitTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; action: ActionRequest }>();
  private listeners = new Set<(event: SchedulerEvent) => void>();
  private cooldowns = new Map<ActionType, number>();
  private agentPaused = false;
  private disposed = false;

  constructor(options?: SchedulerOptions) {
    this.clock = options?.clock ?? (() => Date.now());
    this.executor = options?.executor;
  }

  submit(action: ActionRequest, options: SubmitOptions): string {
    this.ensureNotDisposed();

    const priority = options.priority ?? getDefaultPriority(action.source);

    // Cooldown check
    if (options.cooldownMs !== undefined) {
      const lastCompletion = this.cooldowns.get(action.type);
      if (lastCompletion !== undefined) {
        const elapsed = this.clock() - lastCompletion;
        if (elapsed < options.cooldownMs) {
          this.emit({
            type: "cooldown_rejected",
            actionId: action.id,
            actionType: action.type,
            source: action.source,
            channel: options.channel,
            priority,
            timestamp: this.clock(),
          });
          return action.id;
        }
      }
    }

    // Wait action handling
    if (action.type === "wait") {
      const payload = action.payload as { durationMs: number };
      this.emit({
        type: "submitted",
        actionId: action.id,
        actionType: action.type,
        source: action.source,
        channel: options.channel,
        priority,
        timestamp: this.clock(),
      });
      this.emit({
        type: "started",
        actionId: action.id,
        actionType: action.type,
        source: action.source,
        channel: options.channel,
        priority,
        timestamp: this.clock(),
      });
      const timer = setTimeout(() => {
        this.emit({
          type: "completed",
          actionId: action.id,
          actionType: action.type,
          source: action.source,
          channel: options.channel,
          priority,
          timestamp: this.clock(),
        });
        this.waitTimers.delete(action.id);
      }, payload.durationMs);
      this.waitTimers.set(action.id, { timer, action });
      return action.id;
    }

    // Normal action
    this.emit({
      type: "submitted",
      actionId: action.id,
      actionType: action.type,
      source: action.source,
      channel: options.channel,
      priority,
      timestamp: this.clock(),
    });

    const cooldownMs = options.cooldownMs;
    this.tryStart(action, options.channel, priority, cooldownMs);
    return action.id;
  }

  cancel(actionId: string): boolean {
    this.ensureNotDisposed();

    // Check pending queue
    const pendingIdx = this.pendingQueue.findIndex((p) => p.actionId === actionId);
    if (pendingIdx >= 0) {
      const removed = this.pendingQueue.splice(pendingIdx, 1)[0];
      this.emit({
        type: "cancelled",
        actionId: removed.actionId,
        actionType: removed.action.type,
        source: removed.action.source,
        channel: removed.channel,
        priority: removed.priority,
        timestamp: this.clock(),
      });
      return true;
    }

    // Check active actions
    const active = this.activeActions.get(actionId);
    if (active) {
      active.cancelReason = "cancelled";
      active.abortController.abort();
      if (active.timeoutTimer !== undefined) {
        clearTimeout(active.timeoutTimer);
      }
      this.activeActions.delete(actionId);
      this.emit({
        type: "cancelled",
        actionId: active.actionId,
        actionType: active.action.type,
        source: active.action.source,
        channel: active.channel,
        priority: active.priority,
        timestamp: this.clock(),
      });
      return true;
    }

    // Check wait timers
    const waitTimer = this.waitTimers.get(actionId);
    if (waitTimer) {
      clearTimeout(waitTimer.timer);
      this.waitTimers.delete(actionId);
      this.emit({
        type: "cancelled",
        actionId,
        actionType: waitTimer.action.type,
        source: waitTimer.action.source,
        channel: "timer",
        priority: "idle",
        timestamp: this.clock(),
      });
      return true;
    }

    return false;
  }

  cancelAll(): void {
    // Cancel pending
    const pendingCopy = [...this.pendingQueue];
    this.pendingQueue = [];
    for (const p of pendingCopy) {
      this.emit({
        type: "cancelled",
        actionId: p.actionId,
        actionType: p.action.type,
        source: p.action.source,
        channel: p.channel,
        priority: p.priority,
        timestamp: this.clock(),
      });
    }

    // Cancel active
    const activeCopy = [...this.activeActions.values()];
    for (const a of activeCopy) {
      a.cancelReason = "cancelled";
      a.abortController.abort();
      // Clear timeout timer
      if (a.timeoutTimer !== undefined) {
        clearTimeout(a.timeoutTimer);
      }
      this.activeActions.delete(a.actionId);
      this.emit({
        type: "cancelled",
        actionId: a.actionId,
        actionType: a.action.type,
        source: a.action.source,
        channel: a.channel,
        priority: a.priority,
        timestamp: this.clock(),
      });
    }

    // Cancel wait timers
    const waitCopy = [...this.waitTimers.entries()];
    for (const [actionId, wt] of waitCopy) {
      clearTimeout(wt.timer);
      this.waitTimers.delete(actionId);
      this.emit({
        type: "cancelled",
        actionId,
        actionType: wt.action.type,
        source: wt.action.source,
        channel: "timer",
        priority: "idle",
        timestamp: this.clock(),
      });
    }
  }

  cancelChannel(channel: Channel): void {
    // Cancel pending on this channel
    const remaining: PendingAction[] = [];
    for (const p of this.pendingQueue) {
      if (p.channel === channel) {
        this.emit({
          type: "cancelled",
          actionId: p.actionId,
          actionType: p.action.type,
          source: p.action.source,
          channel: p.channel,
          priority: p.priority,
          timestamp: this.clock(),
        });
      } else {
        remaining.push(p);
      }
    }
    this.pendingQueue = remaining;

    // Cancel active on this channel
    const toDelete: string[] = [];
    for (const [id, a] of this.activeActions) {
      if (a.channel === channel) {
        a.cancelReason = "cancelled";
        a.abortController.abort();
        if (a.timeoutTimer !== undefined) {
          clearTimeout(a.timeoutTimer);
        }
        toDelete.push(id);
        this.emit({
          type: "cancelled",
          actionId: a.actionId,
          actionType: a.action.type,
          source: a.action.source,
          channel: a.channel,
          priority: a.priority,
          timestamp: this.clock(),
        });
      }
    }
    for (const id of toDelete) {
      this.activeActions.delete(id);
    }
  }

  pauseAgentActions(): void {
    this.agentPaused = true;
  }

  resumeAgentActions(): void {
    this.agentPaused = false;
    // Try to schedule pending agent actions on all channels
    const channels = new Set<Channel>();
    for (const p of this.pendingQueue) {
      if (p.action.source === "agent") {
        channels.add(p.channel);
      }
    }
    for (const ch of channels) {
      this.tryScheduleNext(ch);
    }
  }

  onEvent(listener: (event: SchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getActiveActions(): readonly ActiveAction[] {
    const result: ActiveAction[] = [];
    for (const a of this.activeActions.values()) {
      result.push({
        actionId: a.actionId,
        action: a.action,
        channel: a.channel,
        priority: a.priority,
        startedAt: a.startedAt,
      });
    }
    return result;
  }

  getPendingActions(): readonly PendingAction[] {
    return [...this.pendingQueue];
  }

  dispose(): void {
    this.cancelAll();
    this.listeners.clear();
    this.disposed = true;
  }

  // --- Private methods ---

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("调度器已释放");
    }
  }

  private emit(event: SchedulerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private tryStart(
    action: ActionRequest,
    channel: Channel,
    priority: Priority,
    cooldownMs?: number,
  ): void {
    const mutexGroup = getMutexGroup(channel);

    // Check if any channel in the same mutex group has an active action
    const runningOnGroup = this.findActiveOnMutexGroup(mutexGroup);

    if (runningOnGroup) {
      // Mutex group is busy
      if (shouldPreempt(action, priority, runningOnGroup.priority, channel)) {
        // Preempt: abort the running action
        runningOnGroup.cancelReason = "interrupted";
        runningOnGroup.abortController.abort();
        // The running action will clean up via promise settlement
        // Remove it from active actions now so we can start the new one
        this.activeActions.delete(runningOnGroup.actionId);

        // Emit interrupted event for the preempted action
        this.emit({
          type: "interrupted",
          actionId: runningOnGroup.actionId,
          actionType: runningOnGroup.action.type,
          source: runningOnGroup.action.source,
          channel: runningOnGroup.channel,
          priority: runningOnGroup.priority,
          timestamp: this.clock(),
        });

        // Start the new action
        this.startAction(action, channel, priority, cooldownMs);
      } else {
        // Add to pending queue (sorted by priority, FIFO within same priority)
        this.addToPending(action, channel, priority, cooldownMs);
      }
    } else {
      // Mutex group is free
      // Check agent pause
      if (this.agentPaused && action.source === "agent") {
        this.addToPending(action, channel, priority, cooldownMs);
        return;
      }
      this.startAction(action, channel, priority, cooldownMs);
    }
  }

  private startAction(
    action: ActionRequest,
    channel: Channel,
    priority: Priority,
    cooldownMs?: number,
  ): void {
    const abortController = new AbortController();
    const record: ActiveActionRecord = {
      actionId: action.id,
      action,
      channel,
      priority,
      startedAt: this.clock(),
      abortController,
      cancelReason: "interrupted",
      cooldownMs,
    };

    // Timeout handling
    if (action.timeoutMs !== undefined && action.timeoutMs > 0) {
      record.timeoutTimer = setTimeout(() => {
        // Only abort if still running
        const stillActive = this.activeActions.get(action.id);
        if (stillActive) {
          stillActive.cancelReason = "timed_out";
          stillActive.abortController.abort();
          // We signal the timeout via cancelReason; the promise handler will emit "timed_out"
        }
      }, action.timeoutMs);
    }

    this.activeActions.set(action.id, record);

    this.emit({
      type: "started",
      actionId: action.id,
      actionType: action.type,
      source: action.source,
      channel,
      priority,
      timestamp: this.clock(),
    });

    // Execute
    if (!this.executor) {
      throw new Error("未配置执行器");
    }

    const promise = this.executor.execute(action, abortController.signal);

    promise
      .then((result) => {
        this.handleCompletion(action.id, result, channel);
      })
      .catch((error: unknown) => {
        this.handleError(action.id, channel, error);
      });
  }

  private handleCompletion(
    actionId: string,
    result: ActionResult,
    channel: Channel,
  ): void {
    const record = this.activeActions.get(actionId);
    if (!record) return; // Already cleaned up

    // Clear timeout timer
    if (record.timeoutTimer !== undefined) {
      clearTimeout(record.timeoutTimer);
    }

    this.activeActions.delete(actionId);

    // Record cooldown
    if (record.cooldownMs !== undefined) {
      this.cooldowns.set(record.action.type, this.clock());
    }

    // Determine event type: check cancelReason first (for abort cases)
    let emitType: SchedulerEventType;
    if (record.cancelReason === "timed_out") {
      emitType = "timed_out";
    } else if (record.cancelReason === "cancelled") {
      emitType = "cancelled";
    } else {
      emitType = result.status as SchedulerEventType;
    }

    this.emit({
      type: emitType,
      actionId,
      actionType: record.action.type,
      source: record.action.source,
      channel: record.channel,
      priority: record.priority,
      timestamp: this.clock(),
      reason: result.reason,
      errorCode: result.errorCode,
    });

    // Try next action on this channel's mutex group
    this.tryScheduleNext(channel);
  }

  private handleError(
    actionId: string,
    channel: Channel,
    error?: unknown,
  ): void {
    const record = this.activeActions.get(actionId);
    if (!record) return;

    // Clear timeout timer
    if (record.timeoutTimer !== undefined) {
      clearTimeout(record.timeoutTimer);
    }

    this.activeActions.delete(actionId);

    // Record cooldown
    if (record.cooldownMs !== undefined) {
      this.cooldowns.set(record.action.type, this.clock());
    }

    // Determine event type based on whether the signal was actually aborted
    const wasAborted = record.abortController.signal.aborted;
    let emitType: SchedulerEventType;
    if (wasAborted) {
      emitType =
        record.cancelReason === "timed_out" ? "timed_out" :
        record.cancelReason === "cancelled" ? "cancelled" :
        "interrupted";
    } else {
      // Executor rejected on its own, not due to abort
      emitType = "failed";
    }

    this.emit({
      type: emitType,
      actionId,
      actionType: record.action.type,
      source: record.action.source,
      channel: record.channel,
      priority: record.priority,
      timestamp: this.clock(),
      reason: emitType === "interrupted" || emitType === "cancelled" ? undefined : String(error),
      errorCode: undefined,
    });

    // Try next action on this channel
    this.tryScheduleNext(channel);
  }

  private findActiveOnMutexGroup(mutexGroup: string): ActiveActionRecord | undefined {
    for (const a of this.activeActions.values()) {
      if (getMutexGroup(a.channel) === mutexGroup) {
        return a;
      }
    }
    return undefined;
  }

  private addToPending(action: ActionRequest, channel: Channel, priority: Priority, cooldownMs?: number): void {
    const pending: PendingAction = {
      actionId: action.id,
      action,
      channel,
      priority,
      submittedAt: this.clock(),
      cooldownMs,
    };
    // Insert sorted by priority (highest first), FIFO within same priority
    const insertIdx = this.pendingQueue.findIndex((p) => comparePriority(p.priority, priority) < 0);
    if (insertIdx < 0) {
      this.pendingQueue.push(pending);
    } else {
      this.pendingQueue.splice(insertIdx, 0, pending);
    }
  }

  private tryScheduleNext(channel: Channel): void {
    const mutexGroup = getMutexGroup(channel);

    // Check if mutex group is still busy
    if (this.findActiveOnMutexGroup(mutexGroup)) {
      return;
    }

    // Find highest priority pending action on any channel in this mutex group
    let bestIdx = -1;
    let bestPriority: Priority | undefined;
    for (let i = 0; i < this.pendingQueue.length; i++) {
      const p = this.pendingQueue[i];
      if (getMutexGroup(p.channel) === mutexGroup) {
        if (bestIdx < 0 || comparePriority(p.priority, bestPriority!) > 0) {
          bestIdx = i;
          bestPriority = p.priority;
        }
      }
    }
    if (bestIdx < 0) return;

    const next = this.pendingQueue[bestIdx];

    // Check agent pause
    if (this.agentPaused && next.action.source === "agent") {
      return;
    }

    // Remove from pending and start
    this.pendingQueue.splice(bestIdx, 1);
    this.startAction(next.action, next.channel, next.priority, next.cooldownMs);
  }
}
