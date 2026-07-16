import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ActionRequest, ActionStatus, ActionResult, ActionSource } from "../actions/types";
import type { ActionExecutor, SchedulerEvent } from "./types";
import { BehaviorScheduler } from "./scheduler";

// --- Helpers ---

/** Flush microtask queue to let promise settlement handlers run */
async function flush(): Promise<void> {
  // Multiple flushes needed because .then() chains create nested microtasks
  await new Promise<void>((resolve) => resolve());
  await new Promise<void>((resolve) => resolve());
  await new Promise<void>((resolve) => resolve());
}

function makeAction(overrides: Partial<Record<string, unknown>> & { id: string; type: string }): ActionRequest {
  return {
    id: overrides.id,
    type: overrides.type,
    payload: overrides.payload ?? {},
    source: (overrides.source ?? "dev") as ActionSource,
    requestedAt: (overrides.requestedAt ?? 1000) as number,
  } as unknown as ActionRequest;
}

class FakeExecutor implements ActionExecutor {
  calls: { action: ActionRequest; signal: AbortSignal }[] = [];
  private resolvers = new Map<string, (result: ActionResult) => void>();

  async execute(action: ActionRequest, signal: AbortSignal): Promise<ActionResult> {
    this.calls.push({ action, signal });
    return new Promise<ActionResult>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        resolve({ actionId: action.id, status: "interrupted", finishedAt: Date.now() });
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
      this.resolvers.set(action.id, resolve);
    });
  }

  complete(actionId: string, status: ActionStatus = "completed") {
    const resolve = this.resolvers.get(actionId);
    if (resolve) {
      this.resolvers.delete(actionId);
      resolve({ actionId, status, finishedAt: Date.now() });
    }
  }

  get pendingCount() {
    return this.resolvers.size;
  }
}

describe("基本提交与执行", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("提交后通道空闲时立即开始", () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    const actionId = scheduler.submit(action, { channel: "body-motion" });

    expect(actionId).toBe("a1");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("a1");

    const startedEvents = events.filter((e) => e.type === "started");
    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0].actionId).toBe("a1");
  });

  it("提交后通道忙时排队等待", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });

    scheduler.submit(a1, { channel: "body-motion" });
    scheduler.submit(a2, { channel: "body-motion" });

    // Only first should be executing
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("a1");

    // Second should be pending
    const pending = scheduler.getPendingActions();
    expect(pending).toHaveLength(1);
    expect(pending[0].actionId).toBe("a2");
  });

  it("动作完成后触发下一个排队动作", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });

    scheduler.submit(a1, { channel: "body-motion" });
    scheduler.submit(a2, { channel: "body-motion" });

    expect(executor.calls).toHaveLength(1);

    // Complete the first action - this resolves the promise
    executor.complete("a1");

    // Flush microtasks to let promise settlement handlers run
    await flush();

    // Second should now be executing
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[1].action.id).toBe("a2");

    // Pending should be empty
    expect(scheduler.getPendingActions()).toHaveLength(0);
  });

  it("FIFO：相同优先级按提交顺序执行", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    const a3 = makeAction({ id: "a3", type: "motion.play", source: "dev" });

    scheduler.submit(a1, { channel: "body-motion" });
    scheduler.submit(a2, { channel: "body-motion" });
    scheduler.submit(a3, { channel: "body-motion" });

    // Only a1 should be executing
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("a1");

    // Complete a1 → a2 should start
    executor.complete("a1");
    await flush();
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[1].action.id).toBe("a2");

    // Complete a2 → a3 should start
    executor.complete("a2");
    await flush();
    expect(executor.calls).toHaveLength(3);
    expect(executor.calls[2].action.id).toBe("a3");
  });
});

describe("优先级抢占", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("高优先级抢占同通道运行中的低优先级动作", () => {
    // Submit low-priority (agent) first
    const low = makeAction({ id: "low", type: "motion.play", source: "agent" });
    scheduler.submit(low, { channel: "body-motion" });

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("low");

    // Submit high-priority (user) - should preempt
    const high = makeAction({ id: "high", type: "motion.play", source: "user" });
    scheduler.submit(high, { channel: "body-motion" });

    // Low should be interrupted, high should start
    const interruptedEvents = events.filter((e) => e.type === "interrupted");
    expect(interruptedEvents).toHaveLength(1);
    expect(interruptedEvents[0].actionId).toBe("low");

    const startedEvents = events.filter((e) => e.type === "started");
    expect(startedEvents).toHaveLength(2);
    expect(startedEvents[1].actionId).toBe("high");
  });

  it("被抢占的动作发出 interrupted 事件", () => {
    const low = makeAction({ id: "low", type: "motion.play", source: "agent" });
    scheduler.submit(low, { channel: "body-motion" });

    const high = makeAction({ id: "high", type: "motion.play", source: "user" });
    scheduler.submit(high, { channel: "body-motion" });

    const interruptedEvents = events.filter((e) => e.type === "interrupted");
    expect(interruptedEvents).toHaveLength(1);
    expect(interruptedEvents[0].actionId).toBe("low");
  });

  it("低优先级排队等待高优先级完成", () => {
    // Submit high-priority (user) first
    const high = makeAction({ id: "high", type: "motion.play", source: "user" });
    scheduler.submit(high, { channel: "body-motion" });

    // Submit low-priority (agent) - should queue, not preempt
    const low = makeAction({ id: "low", type: "motion.play", source: "agent" });
    scheduler.submit(low, { channel: "body-motion" });

    // Only high should be running
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("high");

    // Low should be pending
    const pending = scheduler.getPendingActions();
    expect(pending).toHaveLength(1);
    expect(pending[0].actionId).toBe("low");
  });

  it("相同优先级不抢占而是排队", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    scheduler.submit(a2, { channel: "body-motion" });

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("a1");
    expect(scheduler.getPendingActions()).toHaveLength(1);
  });
});

describe("跨通道并行", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("不同通道的动作并行执行", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    const a2 = makeAction({ id: "a2", type: "look.set", source: "dev" });
    scheduler.submit(a2, { channel: "gaze-expression" });

    expect(executor.calls).toHaveLength(2);
  });

  it("body-motion 和 outfit 不并行（互斥组）", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    const a2 = makeAction({ id: "a2", type: "outfit.equip", source: "dev" });
    scheduler.submit(a2, { channel: "outfit" });

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("a1");
    expect(scheduler.getPendingActions()).toHaveLength(1);
  });

  it("互斥组动作完成后另一个开始", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    const a2 = makeAction({ id: "a2", type: "outfit.equip", source: "dev" });
    scheduler.submit(a2, { channel: "outfit" });

    expect(executor.calls).toHaveLength(1);

    // Complete body-motion
    executor.complete("a1");
    await flush();

    // Outfit should now start
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[1].action.id).toBe("a2");
  });
});

describe("超时", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("超时后动作被中断", async () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev", requestedAt: 1000 });
    (action as unknown as Record<string, unknown>).timeoutMs = 100;
    scheduler.submit(action, { channel: "body-motion" });

    // Advance time past timeout - this fires setTimeout synchronously
    vi.advanceTimersByTime(100);

    // Flush microtasks to let promise settlement handlers run
    await flush();

    const timedOutEvents = events.filter((e) => e.type === "timed_out");
    expect(timedOutEvents).toHaveLength(1);
    expect(timedOutEvents[0].actionId).toBe("a1");
    expect(scheduler.getActiveActions()).toHaveLength(0);
  });

  it("无超时的动作不会自动中断", () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(action, { channel: "body-motion" });

    vi.advanceTimersByTime(10000);

    expect(scheduler.getActiveActions()).toHaveLength(1);
    const timedOutEvents = events.filter((e) => e.type === "timed_out");
    expect(timedOutEvents).toHaveLength(0);
  });

  it("超时事件包含 actionId", async () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev", requestedAt: 1000 });
    (action as unknown as Record<string, unknown>).timeoutMs = 50;
    scheduler.submit(action, { channel: "body-motion" });

    vi.advanceTimersByTime(50);

    // Flush microtasks to let promise settlement handlers run
    await flush();

    const timedOutEvents = events.filter((e) => e.type === "timed_out");
    expect(timedOutEvents).toHaveLength(1);
    expect(timedOutEvents[0].actionId).toBe("a1");
  });
});

describe("冷却", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("冷却期内相同动作类型被拒绝", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion", cooldownMs: 1000 });

    // Complete the action
    executor.complete("a1");
    await flush();

    // Try submitting same type within cooldown
    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    scheduler.submit(a2, { channel: "body-motion", cooldownMs: 1000 });

    const rejected = events.filter((e) => e.type === "cooldown_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].actionId).toBe("a2");
    expect(executor.calls).toHaveLength(1); // No new execution
  });

  it("冷却期结束后相同动作类型被接受", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion", cooldownMs: 1000 });

    executor.complete("a1");
    await flush();

    // Advance past cooldown
    vi.advanceTimersByTime(1000);

    // Submit same type - should be accepted
    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    scheduler.submit(a2, { channel: "body-motion", cooldownMs: 1000 });

    expect(executor.calls).toHaveLength(2);
    const startedEvents = events.filter((e) => e.type === "started");
    expect(startedEvents).toHaveLength(2);
  });

  it("不同动作类型不受冷却影响", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion", cooldownMs: 1000 });

    executor.complete("a1");
    await flush();

    // Submit different type - should be accepted
    const a2 = makeAction({ id: "a2", type: "expression.set", source: "dev" });
    scheduler.submit(a2, { channel: "gaze-expression", cooldownMs: 1000 });

    expect(executor.calls).toHaveLength(2);
  });

  it("排队后启动的动作也记录冷却", async () => {
    // First action occupies body-motion, second queues with cooldown
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    scheduler.submit(a2, { channel: "body-motion", cooldownMs: 1000 });
    expect(executor.calls).toHaveLength(1); // a2 is queued

    // Complete a1 → a2 starts
    executor.complete("a1");
    await flush();
    expect(executor.calls).toHaveLength(2);

    // Complete a2 → cooldown should be recorded
    executor.complete("a2");
    await flush();

    // Submit same type within cooldown → should be rejected
    const a3 = makeAction({ id: "a3", type: "motion.play", source: "dev" });
    scheduler.submit(a3, { channel: "body-motion", cooldownMs: 1000 });

    const rejected = events.filter((e) => e.type === "cooldown_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].actionId).toBe("a3");
  });
});

describe("取消", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("取消排队中的动作", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });

    scheduler.submit(a1, { channel: "body-motion" });
    scheduler.submit(a2, { channel: "body-motion" });

    expect(scheduler.getPendingActions()).toHaveLength(1);

    const result = scheduler.cancel("a2");

    expect(result).toBe(true);
    expect(scheduler.getPendingActions()).toHaveLength(0);
    const cancelledEvents = events.filter((e) => e.type === "cancelled");
    expect(cancelledEvents).toHaveLength(1);
    expect(cancelledEvents[0].actionId).toBe("a2");
  });

  it("取消运行中的动作", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    expect(scheduler.getActiveActions()).toHaveLength(1);

    const result = scheduler.cancel("a1");

    expect(result).toBe(true);
    const cancelledEvents = events.filter((e) => e.type === "cancelled");
    expect(cancelledEvents).toHaveLength(1);
    expect(cancelledEvents[0].actionId).toBe("a1");
  });

  it("取消不存在的动作返回 false", () => {
    const result = scheduler.cancel("nonexistent");
    expect(result).toBe(false);
  });

  it("cancelAll 取消所有动作", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    const a2 = makeAction({ id: "a2", type: "look.set", source: "dev" });

    scheduler.submit(a1, { channel: "body-motion" });
    scheduler.submit(a2, { channel: "gaze-expression" });

    scheduler.cancelAll();

    expect(scheduler.getActiveActions()).toHaveLength(0);
    expect(scheduler.getPendingActions()).toHaveLength(0);
  });

  it("cancelChannel 取消指定通道的所有动作", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    const a2 = makeAction({ id: "a2", type: "look.set", source: "dev" });

    scheduler.submit(a1, { channel: "body-motion" });
    scheduler.submit(a2, { channel: "gaze-expression" });

    scheduler.cancelChannel("body-motion");

    // body-motion should be cancelled
    const cancelledEvents = events.filter((e) => e.type === "cancelled");
    expect(cancelledEvents).toHaveLength(1);
    expect(cancelledEvents[0].actionId).toBe("a1");

    // gaze-expression should still be active
    expect(executor.calls).toHaveLength(2);
    const startedEvents = events.filter((e) => e.type === "started");
    expect(startedEvents).toHaveLength(2);
  });
});

describe("Agent 暂停", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("暂停后 agent 动作排队但不开始", () => {
    scheduler.pauseAgentActions();

    const agentAction = makeAction({ id: "a1", type: "motion.play", source: "agent" });
    scheduler.submit(agentAction, { channel: "body-motion" });

    expect(executor.calls).toHaveLength(0);
    expect(scheduler.getPendingActions()).toHaveLength(1);
  });

  it("恢复后排队的 agent 动作开始", () => {
    scheduler.pauseAgentActions();

    const agentAction = makeAction({ id: "a1", type: "motion.play", source: "agent" });
    scheduler.submit(agentAction, { channel: "body-motion" });

    expect(executor.calls).toHaveLength(0);

    scheduler.resumeAgentActions();

    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("a1");
  });

  it("暂停不影响非 agent 动作", () => {
    scheduler.pauseAgentActions();

    const userAction = makeAction({ id: "a1", type: "motion.play", source: "user" });
    scheduler.submit(userAction, { channel: "body-motion" });

    expect(executor.calls).toHaveLength(1);
  });

  it("暂停不影响已运行的 agent 动作", () => {
    const agentAction = makeAction({ id: "a1", type: "motion.play", source: "agent" });
    scheduler.submit(agentAction, { channel: "body-motion" });

    expect(executor.calls).toHaveLength(1);

    scheduler.pauseAgentActions();

    expect(executor.calls).toHaveLength(1);
    expect(scheduler.getActiveActions()).toHaveLength(1);
  });
});

describe("wait 动作", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("wait 在 durationMs 后完成", () => {
    const wait = makeAction({ id: "w1", type: "wait", payload: { durationMs: 500 }, source: "dev" });
    scheduler.submit(wait, { channel: "timer" });

    expect(events.filter((e) => e.type === "started")).toHaveLength(1);

    // Advance time
    vi.advanceTimersByTime(500);

    const completed = events.filter((e) => e.type === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].actionId).toBe("w1");
  });

  it("wait 不阻塞其他通道", () => {
    const wait = makeAction({ id: "w1", type: "wait", payload: { durationMs: 500 }, source: "dev" });
    scheduler.submit(wait, { channel: "timer" });

    const motion = makeAction({ id: "m1", type: "motion.play", source: "dev" });
    scheduler.submit(motion, { channel: "body-motion" });

    // Both should be active
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0].action.id).toBe("m1");
  });

  it("wait 可以被取消", () => {
    const wait = makeAction({ id: "w1", type: "wait", payload: { durationMs: 500 }, source: "dev" });
    scheduler.submit(wait, { channel: "timer" });

    const result = scheduler.cancel("w1");

    expect(result).toBe(true);
    const cancelledEvents = events.filter((e) => e.type === "cancelled");
    expect(cancelledEvents).toHaveLength(1);
    expect(cancelledEvents[0].actionId).toBe("w1");

    // Advance time - should NOT complete
    vi.advanceTimersByTime(500);
    const completed = events.filter((e) => e.type === "completed");
    expect(completed).toHaveLength(0);
  });
});

describe("事件追踪", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("提交时发出 submitted 事件", () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(action, { channel: "body-motion" });

    const submitted = events.filter((e) => e.type === "submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].actionId).toBe("a1");
  });

  it("开始时发出 started 事件", () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(action, { channel: "body-motion" });

    const started = events.filter((e) => e.type === "started");
    expect(started).toHaveLength(1);
    expect(started[0].actionId).toBe("a1");
  });

  it("完成时发出 completed 事件", async () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(action, { channel: "body-motion" });

    executor.complete("a1");
    await flush();

    const completed = events.filter((e) => e.type === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].actionId).toBe("a1");
  });

  it("事件包含 actionId、actionType、source、channel、priority、timestamp", () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "user" });
    scheduler.submit(action, { channel: "body-motion", priority: "user" });

    const submitted = events.find((e) => e.type === "submitted")!;
    expect(submitted.actionId).toBe("a1");
    expect(submitted.actionType).toBe("motion.play");
    expect(submitted.source).toBe("user");
    expect(submitted.channel).toBe("body-motion");
    expect(submitted.priority).toBe("user");
    expect(typeof submitted.timestamp).toBe("number");
  });

  it("onEvent 返回取消订阅函数", () => {
    // Start with a fresh scheduler (no beforeEach listener)
    const sched = new BehaviorScheduler({ executor: new FakeExecutor() });
    const evts: SchedulerEvent[] = [];
    const listener = (e: SchedulerEvent) => evts.push(e);
    const unsubscribe = sched.onEvent(listener);

    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    sched.submit(action, { channel: "body-motion" });

    expect(evts).toHaveLength(2); // submitted + started

    // Unsubscribe and submit another
    unsubscribe();
    const action2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    sched.submit(action2, { channel: "body-motion" });

    // Should still have only 2 events from first action
    expect(evts).toHaveLength(2);

    sched.dispose();
  });
});

describe("依赖注入", () => {
  it("自定义时钟用于时间戳", () => {
    const clock = () => 9999;
    const scheduler = new BehaviorScheduler({ clock, executor: new FakeExecutor() });
    const events: SchedulerEvent[] = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));

    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(action, { channel: "body-motion" });

    expect(events[0].timestamp).toBe(9999);
    scheduler.dispose();
  });

  it("自定义 ID 生成器用于内部 ID", () => {
    // This test verifies the generateId option is accepted
    const generateId = () => "custom-id";
    const scheduler = new BehaviorScheduler({
      generateId,
      executor: new FakeExecutor(),
    });
    scheduler.dispose();
  });
});

describe("释放", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispose 取消所有动作", () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    scheduler.submit(a2, { channel: "body-motion" });

    expect(scheduler.getActiveActions()).toHaveLength(1);
    expect(scheduler.getPendingActions()).toHaveLength(1);

    scheduler.dispose();

    expect(scheduler.getActiveActions()).toHaveLength(0);
    expect(scheduler.getPendingActions()).toHaveLength(0);
  });

  it("dispose 后提交抛出错误", () => {
    scheduler.dispose();

    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    expect(() => {
      scheduler.submit(action, { channel: "body-motion" });
    }).toThrow("调度器已释放");
  });
});

describe("异常清理", () => {
  let executor: FakeExecutor;
  let scheduler: BehaviorScheduler;
  let events: SchedulerEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    executor = new FakeExecutor();
    scheduler = new BehaviorScheduler({ executor });
    events = [];
    scheduler.onEvent((e: SchedulerEvent) => events.push(e));
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("执行器抛出异常时发出 failed 事件", async () => {
    const action = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(action, { channel: "body-motion" });

    // Complete with "failed" status to simulate executor failure
    executor.complete("a1", "failed");

    await flush();

    const failed = events.filter((e) => e.type === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].actionId).toBe("a1");
  });

  it("执行器抛出后通道可接受新动作", async () => {
    const a1 = makeAction({ id: "a1", type: "motion.play", source: "dev" });
    scheduler.submit(a1, { channel: "body-motion" });

    // Simulate executor failure
    executor.complete("a1", "failed");
    await flush();

    // After the executor fails, channel should be free
    const a2 = makeAction({ id: "a2", type: "motion.play", source: "dev" });
    scheduler.submit(a2, { channel: "body-motion" });

    const startedEvents = events.filter((e) => e.type === "started");
    expect(startedEvents).toHaveLength(2);
  });

  it("abort 后执行器抛出时发出 interrupted 而非 failed", async () => {
    // Create a scheduler with an executor that throws on abort
    const abortExecutor = new (class implements ActionExecutor {
      async execute(_action: ActionRequest, signal: AbortSignal): Promise<ActionResult> {
        return new Promise<ActionResult>((_resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            reject(new Error("aborted"));
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort);
        });
      }
    })();

    const sched = new BehaviorScheduler({ executor: abortExecutor });
    const evts: SchedulerEvent[] = [];
    sched.onEvent((e: SchedulerEvent) => evts.push(e));

    const low = makeAction({ id: "low", type: "motion.play", source: "agent" });
    sched.submit(low, { channel: "body-motion" });

    const high = makeAction({ id: "high", type: "motion.play", source: "user" });
    sched.submit(high, { channel: "body-motion" });

    await vi.runAllTimersAsync();

    // Low should be interrupted (not failed)
    const interrupted = evts.filter((e) => e.type === "interrupted");
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].actionId).toBe("low");

    const failed = evts.filter((e) => e.type === "failed");
    expect(failed).toHaveLength(0);

    sched.dispose();
  });
});
