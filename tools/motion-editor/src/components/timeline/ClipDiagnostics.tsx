import type { CharacterRigV1, MotionClipV1, MotionEventType } from "@ltypet/character-motion";
import { diagnoseClip } from "../../editor/model/clipDiagnostics";

interface Props {
  clip: MotionClipV1;
  rig: CharacterRigV1;
  supportedEvents?: readonly MotionEventType[];
}

const CATEGORY_LABELS = {
  "missing-part": "缺失 Part",
  "empty-track": "空轨道",
  "out-of-range": "越界",
  "invalid-slot": "非法 slot",
  "unsupported-event": "未支持事件",
  suppression: "suppression",
} as const;

export function ClipDiagnostics({ clip, rig, supportedEvents }: Props) {
  const summary = diagnoseClip(clip, rig, supportedEvents);
  return (
    <section className="clip-diagnostics" aria-label={`${clip.id} 动作诊断`}>
      <div className="clip-diagnostics-heading">
        <strong>Clip 诊断</strong>
        <span className={summary.hasErrors ? "diag-error" : "diag-info"}>
          {summary.items.length === 0 ? "未发现问题" : `${summary.items.length} 项`}
        </span>
      </div>
      {summary.items.length > 0 && (
        <div className="clip-diagnostic-counts">
          {Object.entries(summary.counts).flatMap(([category, count]) => count > 0
            ? [<span key={category}>{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]} {count}</span>]
            : [])}
        </div>
      )}
      {summary.items.length > 0 && (
        <ul>
          {summary.items.map((item, index) => (
            <li key={`${item.category}-${item.message}-${index}`} className={`diag-${item.severity}`}>
              {item.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
