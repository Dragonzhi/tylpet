import { useState } from "react";
import type { CharacterRigV1, RigPartV1 } from "@ltypet/character-motion";

interface Props {
  rig: CharacterRigV1;
  selectedPartId: string | null;
  hiddenPartIds: Set<string>;
  lockedPartIds: Set<string>;
  onSelect(partId: string): void;
  onToggleHidden(partId: string): void;
  onToggleLocked(partId: string): void;
}

export function PartTree({
  rig,
  selectedPartId,
  hiddenPartIds,
  lockedPartIds,
  onSelect,
  onToggleHidden,
  onToggleLocked,
}: Props) {
  const [collapsedPartIds, setCollapsedPartIds] = useState<Set<string>>(new Set());
  const children = new Map<string | null, RigPartV1[]>();
  for (const part of rig.parts) {
    const list = children.get(part.logicalParentId) ?? [];
    list.push(part);
    children.set(part.logicalParentId, list);
  }
  const slotIndex = new Map(rig.renderSlots.map((slot, index) => [slot, index]));
  for (const list of children.values()) {
    list.sort((left, right) =>
      (slotIndex.get(left.defaultRenderSlot) ?? 0) - (slotIndex.get(right.defaultRenderSlot) ?? 0));
  }

  const renderPart = (part: RigPartV1, depth: number): React.ReactNode => {
    const partChildren = children.get(part.id) ?? [];
    const collapsed = collapsedPartIds.has(part.id);
    return (
    <li key={part.id}>
      <div
        className={`part-row ${selectedPartId === part.id ? "selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <button
          type="button"
          className="icon-button disclosure"
          aria-label={`${collapsed ? "展开" : "折叠"} ${part.id}`}
          disabled={partChildren.length === 0}
          onClick={() => setCollapsedPartIds((current) => {
            const next = new Set(current);
            if (next.has(part.id)) next.delete(part.id); else next.add(part.id);
            return next;
          })}
        >
          {partChildren.length === 0 ? "" : collapsed ? "▸" : "▾"}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`${hiddenPartIds.has(part.id) ? "显示" : "隐藏"} ${part.id}`}
          title={hiddenPartIds.has(part.id) ? "显示" : "隐藏"}
          onClick={() => onToggleHidden(part.id)}
        >
          {hiddenPartIds.has(part.id) ? "○" : "●"}
        </button>
        <button
          type="button"
          className="part-name"
          onClick={() => onSelect(part.id)}
          title={`${part.id} · ${part.defaultRenderSlot}`}
        >
          {part.id}
        </button>
        {part.tags?.includes("has_pivot") && <span className="pivot-badge" title="有 pivot">◆</span>}
        <button
          type="button"
          className="icon-button"
          aria-label={`${lockedPartIds.has(part.id) ? "解锁" : "锁定"} ${part.id}`}
          title={lockedPartIds.has(part.id) ? "解锁" : "锁定"}
          onClick={() => onToggleLocked(part.id)}
        >
          {lockedPartIds.has(part.id) ? "🔒" : "🔓"}
        </button>
      </div>
      {partChildren.length > 0 && !collapsed && (
        <ul>{partChildren.map((child) => renderPart(child, depth + 1))}</ul>
      )}
    </li>
    );
  };

  return (
    <section className="panel part-tree-panel" aria-label="角色部件树">
      <h2>Part / Rig</h2>
      <ul className="part-tree">{(children.get(null) ?? []).map((part) => renderPart(part, 0))}</ul>
    </section>
  );
}
