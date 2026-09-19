import { OBSERVATION_REACTION_COOLDOWN_MS } from "../../config/observation";
import type { CapabilitySet } from "../capabilities/capabilities";
import type { ObservationEvent, ObservationReaction } from "./types";
import { resolveCompanionCueMotion } from "../companion/catalog";

/**
 * 外部状态只映射为本地白名单语义动作。媒体事件使用专用持续状态，
 * 不拿 wave/stretch 等一次性动作冒充音乐反应。
 */
export function mapObservationToReaction(
  event: ObservationEvent,
  capabilities: CapabilitySet,
): ObservationReaction | null {
  const renderer = capabilities.renderer;
  if (!renderer) return null;
  if (event.type === "media.playback") {
    return renderer.mediaReaction === true
      ? { type: "media.react", payload: { state: event.payload.state }, cooldownMs: 0 }
      : null;
  }
  switch (event.payload.state) {
    case "waiting_for_user":
      return renderer.expressions.includes("blink")
        ? { type: "expression.set", payload: { expression: "blink", durationMs: 350 }, cooldownMs: OBSERVATION_REACTION_COOLDOWN_MS }
        : null;
    case "completed":
      {
        const motion = resolveCompanionCueMotion("task.complete", renderer.motions);
        return motion
          ? { type: "motion.play", payload: { motion, speed: 1 }, cooldownMs: OBSERVATION_REACTION_COOLDOWN_MS }
          : null;
      }
    case "failed":
      {
        const motion = resolveCompanionCueMotion("task.failed", renderer.motions);
        return motion
          ? { type: "motion.play", payload: { motion, speed: 0.85 }, cooldownMs: OBSERVATION_REACTION_COOLDOWN_MS }
          : null;
      }
    case "session_started":
    case "working":
    case "stopped":
      return null;
  }
}
