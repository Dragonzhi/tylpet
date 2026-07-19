import { useEffect, useState } from "react";
import type {
  CharacterRigV1,
  EasingValue,
  MotionKeyframeV1,
  TransformValue,
} from "@ltypet/character-motion";

type NumericProperty = keyof TransformValue;

interface Props {
  rig: CharacterRigV1;
  partId: string | null;
  frame: number;
  sampled: TransformValue | null;
  keyframe: MotionKeyframeV1 | null;
  onInsert(): void;
  onUpdateValues(values: Partial<MotionKeyframeV1["values"]>): void;
  onRemoveRenderSlot(): void;
  onUpdateEasing(easing: EasingValue): void;
  onUpdatePivot(x: number, y: number): void;
}

function NumericInput({
  label,
  value,
  disabled,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  step?: number;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(5))));
  useEffect(() => setDraft(String(Number(value.toFixed(5)))), [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) onCommit(next);
    else setDraft(String(Number(value.toFixed(5))));
  };
  return (
    <label className="field-row">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        step={step ?? 0.1}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(String(Number(value.toFixed(5))));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

const NUMERIC_FIELDS: Array<{ property: NumericProperty; label: string; step?: number }> = [
  { property: "x", label: "X" },
  { property: "y", label: "Y" },
  { property: "rotation", label: "旋转", step: 1 },
  { property: "scaleX", label: "缩放 X", step: 0.01 },
  { property: "scaleY", label: "缩放 Y", step: 0.01 },
  { property: "opacity", label: "透明度", step: 0.05 },
];

export function TransformInspector({
  rig,
  partId,
  frame,
  sampled,
  keyframe,
  onInsert,
  onUpdateValues,
  onRemoveRenderSlot,
  onUpdateEasing,
  onUpdatePivot,
}: Props) {
  if (!partId || !sampled) return <section className="panel inspector"><h2>属性</h2><p className="placeholder">请选择 Part</p></section>;
  const part = rig.parts.find((candidate) => candidate.id === partId);
  if (!part) return null;
  const easing = keyframe?.easing ?? "linear";

  return (
    <section className="panel inspector" aria-label="属性面板">
      <h2>属性</h2>
      <p className="selection-caption">{partId} · 第 {frame} 帧</p>
      {!keyframe && (
        <div className="insert-notice">
          当前显示采样值，尚未打帧。
          <button type="button" onClick={onInsert}>在此帧插入关键帧（F6）</button>
        </div>
      )}
      <fieldset>
        <legend>Transform</legend>
        {NUMERIC_FIELDS.map(({ property, label, step }) => (
          <NumericInput
            key={property}
            label={label}
            value={sampled[property]}
            step={step}
            disabled={!keyframe}
            onCommit={(value) => onUpdateValues({ [property]: value })}
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>Pivot（Part-local）</legend>
        <NumericInput label="X" value={part.pivot.x} disabled={false} onCommit={(x) => onUpdatePivot(x, part.pivot.y)} />
        <NumericInput label="Y" value={part.pivot.y} disabled={false} onCommit={(y) => onUpdatePivot(part.pivot.x, y)} />
      </fieldset>
      <fieldset disabled={!keyframe}>
        <legend>出段缓动</legend>
        <label className="field-row">
          <span>Easing</span>
          <select
            value={typeof easing === "string" ? easing : "cubic"}
            onChange={(event) => {
              const value = event.target.value;
              onUpdateEasing(value === "cubic" ? { cubicBezier: [0.25, 0.1, 0.25, 1] } : value as EasingValue);
            }}
          >
            <option value="linear">linear</option>
            <option value="easeIn">easeIn</option>
            <option value="easeOut">easeOut</option>
            <option value="easeInOut">easeInOut</option>
            <option value="cubic">cubic-bezier</option>
          </select>
        </label>
        {typeof easing === "object" && easing.cubicBezier.map((value, index) => (
          <NumericInput
            key={index}
            label={`控制点 ${index + 1}`}
            value={value}
            step={0.05}
            disabled={!keyframe}
            onCommit={(nextValue) => {
              const cubicBezier = [...easing.cubicBezier] as [number, number, number, number];
              cubicBezier[index] = index === 0 || index === 2
                ? Math.max(0, Math.min(1, nextValue))
                : nextValue;
              onUpdateEasing({ cubicBezier });
            }}
          />
        ))}
      </fieldset>
      <fieldset disabled={!keyframe}>
        <legend>Render Slot（离散）</legend>
        <label className="field-row">
          <span>槽位</span>
          <select
            value={keyframe?.values.renderSlot ?? ""}
            onChange={(event) => {
              if (event.target.value) onUpdateValues({ renderSlot: event.target.value });
              else onRemoveRenderSlot();
            }}
          >
            <option value="">未在此帧设置</option>
            {rig.renderSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        </label>
      </fieldset>
    </section>
  );
}
