import type {
  CharacterRigV1,
  MotionClipV1,
  MotionEventType,
  ProceduralChannel,
} from "@ltypet/character-motion";

export type ClipDiagnosticCategory =
  | "missing-part"
  | "empty-track"
  | "out-of-range"
  | "invalid-slot"
  | "unsupported-event"
  | "suppression";

export interface ClipDiagnosticItem {
  category: ClipDiagnosticCategory;
  severity: "error" | "warn" | "info";
  message: string;
}

export interface ClipDiagnosticSummary {
  clipId: string;
  items: ClipDiagnosticItem[];
  counts: Record<ClipDiagnosticCategory, number>;
  hasErrors: boolean;
}

const DEFAULT_SUPPORTED_EVENTS: readonly MotionEventType[] = ["blink", "mouthOpen", "mouthClose"];
const VALID_SUPPRESSION = new Set<ProceduralChannel>([
  "breathing",
  "blinking",
  "pointer-follow",
  "hair-physics",
  "ear-twitch",
]);

export function diagnoseClip(
  clip: MotionClipV1,
  rig: CharacterRigV1,
  supportedEvents: readonly MotionEventType[] = DEFAULT_SUPPORTED_EVENTS,
): ClipDiagnosticSummary {
  const items: ClipDiagnosticItem[] = [];
  const partIds = new Set(rig.parts.map((part) => part.id));
  const slots = new Set(rig.renderSlots);
  const supported = new Set<MotionEventType>(supportedEvents);

  for (const track of clip.tracks) {
    if (!partIds.has(track.partId)) {
      items.push({ category: "missing-part", severity: "error", message: `轨道引用缺失 Part：${track.partId}` });
    }
    if (track.keyframes.length === 0) {
      items.push({ category: "empty-track", severity: "warn", message: `空轨道：${track.partId}` });
    }
    for (const keyframe of track.keyframes) {
      if (!Number.isInteger(keyframe.frame) || keyframe.frame < 0 || keyframe.frame > clip.durationFrames) {
        items.push({
          category: "out-of-range",
          severity: "error",
          message: `${track.partId} 的关键帧 ${keyframe.frame} 超出 0—${clip.durationFrames}`,
        });
      }
      const slot = keyframe.values.renderSlot;
      if (slot !== undefined && !slots.has(slot)) {
        items.push({ category: "invalid-slot", severity: "error", message: `${track.partId}/${keyframe.frame} 使用非法 slot：${slot}` });
      }
    }
  }

  for (const event of clip.events) {
    if (!Number.isInteger(event.frame) || event.frame < 0 || event.frame > clip.durationFrames) {
      items.push({ category: "out-of-range", severity: "error", message: `事件 ${event.type}/${event.frame} 超出 Clip 范围` });
    }
    if (!supported.has(event.type)) {
      items.push({ category: "unsupported-event", severity: "warn", message: `运行时未支持事件：${event.type}` });
    }
  }

  for (const channel of clip.suppressProceduralChannels ?? []) {
    items.push({
      category: "suppression",
      severity: VALID_SUPPRESSION.has(channel) ? "info" : "error",
      message: VALID_SUPPRESSION.has(channel) ? `抑制程序动画：${channel}` : `非法 suppression：${channel}`,
    });
  }

  const counts: ClipDiagnosticSummary["counts"] = {
    "missing-part": 0,
    "empty-track": 0,
    "out-of-range": 0,
    "invalid-slot": 0,
    "unsupported-event": 0,
    suppression: 0,
  };
  for (const item of items) counts[item.category] += 1;
  return { clipId: clip.id, items, counts, hasErrors: items.some((item) => item.severity === "error") };
}
