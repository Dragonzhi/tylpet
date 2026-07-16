import type { ActionRequest, ActionSource } from "../actions/types";
import type { Channel, MutexGroup, Priority } from "./types";

// Priority values (higher = more important)
const PRIORITY_VALUES: Record<Priority, number> = {
  "safety-stop": 5,
  user: 4,
  menu: 3,
  timer: 2,
  agent: 1,
  idle: 0,
};

/**
 * Default priority based on action source.
 */
const SOURCE_PRIORITY: Record<ActionSource, Priority> = {
  user: "user",
  agent: "agent",
  timer: "timer",
  system: "safety-stop",
  dev: "idle",
};

export function getDefaultPriority(source: ActionSource): Priority {
  return SOURCE_PRIORITY[source];
}

/**
 * Compare priorities: returns positive if a > b, negative if a < b, 0 if equal.
 */
export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_VALUES[a] - PRIORITY_VALUES[b];
}

/**
 * Mutex group mapping: body-motion and outfit share "body" group.
 */
const CHANNEL_MUTEX_GROUP: Record<Channel, MutexGroup> = {
  locomotion: "locomotion",
  "body-motion": "body",
  "gaze-expression": "gaze",
  speech: "speech",
  outfit: "body", // shares group with body-motion!
  timer: "timer",
};

/**
 * Get the mutex group for a channel.
 */
export function getMutexGroup(channel: Channel): MutexGroup {
  return CHANNEL_MUTEX_GROUP[channel];
}

/**
 * Check if two channels share a mutex group.
 */
export function shareMutexGroup(a: Channel, b: Channel): boolean {
  return getMutexGroup(a) === getMutexGroup(b);
}

/**
 * Default channel mapping for action types.
 */
const DEFAULT_CHANNEL: Record<string, Channel | undefined> = {
  "motion.play": "body-motion",
  "expression.set": "gaze-expression",
  "look.set": "gaze-expression",
  "window.move": "locomotion",
  "outfit.equip": "outfit",
  "speech.say": "speech",
  "timer.start": "timer",
  "timer.pause": "timer",
  "timer.cancel": "timer",
  // "wait" has no channel — handled internally by scheduler
};

/**
 * Get the default channel for an action type.
 */
export function getDefaultChannel(actionType: string): Channel | undefined {
  return DEFAULT_CHANNEL[actionType];
}

/**
 * Determine if a new action should preempt a running action on the same mutex group.
 *
 * Rules:
 * 1. Higher priority always preempts lower
 * 2. Equal priority: FIFO (no preempt) EXCEPT speech channel with interrupt=true in payload
 * 3. Lower priority never preempts
 */
export function shouldPreempt(
  newAction: ActionRequest,
  newPriority: Priority,
  runningPriority: Priority,
  channel: Channel,
): boolean {
  const cmp = comparePriority(newPriority, runningPriority);
  if (cmp > 0) return true; // higher priority preempts
  if (cmp < 0) return false; // lower priority doesn't

  // Equal priority: check speech interrupt flag
  if (channel === "speech" && newAction.type === "speech.say") {
    const payload = newAction.payload as { interrupt?: boolean };
    return payload.interrupt === true;
  }
  return false; // FIFO for equal priority
}
