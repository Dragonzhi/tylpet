import type { ActionRequest } from "../actions/types";

export interface RendererCapabilities {
  motions: readonly string[];
  expressions: readonly string[];
  lookDirection: boolean;
  outfits: readonly string[];
  /** 是否支持只含 playing/paused/stopped 的持续媒体视觉反应。 */
  mediaReaction?: boolean;
}

export interface CapabilitySet {
  renderer?: RendererCapabilities;
  window?: boolean;
  speech?: boolean;
  timer?: boolean;
  /** 仅由聊天窗口按本轮设置临时补充，不由主窗口或插件公布。 */
  memory?: boolean;
}

export function isActionSupported(
  action: ActionRequest,
  capabilities: CapabilitySet,
): boolean {
  switch (action.type) {
    case "motion.play":
      return (
        capabilities.renderer != null &&
        capabilities.renderer.motions.includes(action.payload.motion)
      );
    case "expression.set":
      return (
        capabilities.renderer != null &&
        capabilities.renderer.expressions.includes(action.payload.expression)
      );
    case "look.set":
      return (
        capabilities.renderer != null &&
        capabilities.renderer.lookDirection === true
      );
    case "outfit.equip":
      return (
        capabilities.renderer != null &&
        capabilities.renderer.outfits.includes(action.payload.outfitId)
      );
    case "window.move":
      return capabilities.window === true;
    case "speech.say":
      return capabilities.speech === true;
    case "memory.propose":
      return capabilities.memory === true;
    case "timer.start":
    case "timer.pause":
    case "timer.resume":
    case "timer.cancel":
      return capabilities.timer === true;
    case "media.react":
      return capabilities.renderer?.mediaReaction === true;
    case "wait":
      return true;
  }
}
