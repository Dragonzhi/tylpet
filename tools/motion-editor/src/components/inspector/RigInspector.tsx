import { useEffect, useState } from "react";
import type {
  CharacterRigV1,
  SourceBinding,
} from "@ltypet/character-motion";

interface Props {
  rig: CharacterRigV1;
  partId: string | null;
  onRenamePart(nextPartId: string): void;
  onUpdateSourceBinding(sourceBinding: SourceBinding): void;
  onReparent(logicalParentId: string | null): void;
  onUpdateDefaultRenderSlot(renderSlot: string): void;
}

const SOURCE_BINDING_KINDS: SourceBinding["kind"][] = [
  "inkscapeLabel",
  "elementId",
  "dataPart",
];

export function RigInspector({
  rig,
  partId,
  onRenamePart,
  onUpdateSourceBinding,
  onReparent,
  onUpdateDefaultRenderSlot,
}: Props) {
  const part = rig.parts.find((candidate) => candidate.id === partId) ?? null;
  const [partIdDraft, setPartIdDraft] = useState(part?.id ?? "");
  const [bindingValueDraft, setBindingValueDraft] = useState(part?.sourceBinding.value ?? "");

  useEffect(() => {
    setPartIdDraft(part?.id ?? "");
    setBindingValueDraft(part?.sourceBinding.value ?? "");
  }, [part]);

  if (!part) {
    return (
      <section className="panel inspector rig-inspector" aria-labelledby="rig-inspector-heading">
        <h2 id="rig-inspector-heading">Rig</h2>
        <p className="placeholder">请选择 Part</p>
      </section>
    );
  }

  const commitPartId = () => {
    const nextPartId = partIdDraft.trim();
    if (!nextPartId || nextPartId === part.id) {
      setPartIdDraft(part.id);
      return;
    }
    onRenamePart(nextPartId);
    setPartIdDraft(part.id);
  };
  const commitBindingValue = () => {
    const value = bindingValueDraft.trim();
    if (!value || value === part.sourceBinding.value) {
      setBindingValueDraft(part.sourceBinding.value);
      return;
    }
    onUpdateSourceBinding({ ...part.sourceBinding, value });
    setBindingValueDraft(part.sourceBinding.value);
  };

  return (
    <section className="panel inspector rig-inspector" aria-labelledby="rig-inspector-heading">
      <h2 id="rig-inspector-heading">Rig</h2>
      <p className="selection-caption">{part.id}</p>
      <fieldset>
        <legend>Part 语义</legend>
        <label className="field-row">
          <span>语义 ID</span>
          <input
            value={partIdDraft}
            aria-label="Part 语义 ID"
            onChange={(event) => setPartIdDraft(event.target.value)}
            onBlur={commitPartId}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setPartIdDraft(part.id);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label className="field-row">
          <span>绑定类型</span>
          <select
            value={part.sourceBinding.kind}
            aria-label="Source binding kind"
            onChange={(event) => onUpdateSourceBinding({
              kind: event.target.value as SourceBinding["kind"],
              value: part.sourceBinding.value,
            })}
          >
            {SOURCE_BINDING_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
        <label className="field-row">
          <span>绑定值</span>
          <input
            value={bindingValueDraft}
            aria-label="Source binding value"
            onChange={(event) => setBindingValueDraft(event.target.value)}
            onBlur={commitBindingValue}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setBindingValueDraft(part.sourceBinding.value);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>层级与默认绘制</legend>
        <label className="field-row">
          <span>逻辑父级</span>
          <select
            value={part.logicalParentId ?? ""}
            aria-describedby="reparent-bind-pose-hint"
            onChange={(event) => onReparent(event.target.value || null)}
          >
            <option value="">无（根 Part）</option>
            {rig.parts.filter((candidate) => candidate.id !== part.id).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.id}</option>
            ))}
          </select>
        </label>
        <p id="reparent-bind-pose-hint" className="rig-reparent-hint">
          Reparent 会保持世界 bind pose。当前 parent：{part.logicalParentId ?? "无"}；当前 binding：{part.sourceBinding.kind} = {part.sourceBinding.value}
        </p>
        <label className="field-row">
          <span>默认槽位</span>
          <select
            value={part.defaultRenderSlot}
            onChange={(event) => onUpdateDefaultRenderSlot(event.target.value)}
          >
            {rig.renderSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        </label>
      </fieldset>
    </section>
  );
}
