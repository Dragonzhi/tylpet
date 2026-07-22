import { TIMELINE_PROPERTIES } from "../../timeline/model";
import type { TimelineProperty } from "../../timeline/model";
import type { NumericProperty } from "./useTimelineView";

const NUMERIC_PROPERTIES = TIMELINE_PROPERTIES.filter(
  (property): property is { id: NumericProperty; label: string } => property.id !== "renderSlot",
);

interface TimelineToolsProps {
  partFilter: string;
  onPartFilterChange: (value: string) => void;
  availablePartIds: string[];
  propertyFilter: TimelineProperty | "";
  onPropertyFilterChange: (value: TimelineProperty | "") => void;
  keyedOnly: boolean;
  onKeyedOnlyChange: (value: boolean) => void;
  rangeStart: string;
  onRangeStartChange: (value: string) => void;
  rangeEnd: string;
  onRangeEndChange: (value: string) => void;
  durationFrames: number;
  onZoomToRange: () => void;
  moveDelta: string;
  onMoveDeltaChange: (value: string) => void;
  hasSelection: boolean;
  onMoveSelected: () => void;
  adjustProperty: NumericProperty;
  onAdjustPropertyChange: (value: NumericProperty) => void;
  adjustDelta: string;
  onAdjustDeltaChange: (value: string) => void;
  hasAdjustHandler: boolean;
  onAdjustSelected: () => void;
}

export function TimelineTools({
  partFilter,
  onPartFilterChange,
  availablePartIds,
  propertyFilter,
  onPropertyFilterChange,
  keyedOnly,
  onKeyedOnlyChange,
  rangeStart,
  onRangeStartChange,
  rangeEnd,
  onRangeEndChange,
  durationFrames,
  onZoomToRange,
  moveDelta,
  onMoveDeltaChange,
  hasSelection,
  onMoveSelected,
  adjustProperty,
  onAdjustPropertyChange,
  adjustDelta,
  onAdjustDeltaChange,
  hasAdjustHandler,
  onAdjustSelected,
}: TimelineToolsProps) {
  return (
    <div className="timeline-tools" aria-label="时间轴效率工具">
      <label>
        Part
        <select value={partFilter} onChange={(event) => onPartFilterChange(event.target.value)}>
          <option value="">全部</option>
          {availablePartIds.map((partId) => <option key={partId} value={partId}>{partId}</option>)}
        </select>
      </label>
      <label>
        属性
        <select value={propertyFilter} onChange={(event) => onPropertyFilterChange(event.target.value as TimelineProperty | "")}>
          <option value="">全部</option>
          {TIMELINE_PROPERTIES.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}
        </select>
      </label>
      <label className="timeline-check">
        <input type="checkbox" checked={keyedOnly} onChange={(event) => onKeyedOnlyChange(event.target.checked)} />
        仅有关键帧
      </label>
      <span className="timeline-tool-separator" />
      <label>区间 <input aria-label="区间起始帧" type="number" min="0" max={durationFrames} value={rangeStart} onChange={(event) => onRangeStartChange(event.target.value)} /></label>
      <span>—</span>
      <input aria-label="区间结束帧" type="number" min="0" max={durationFrames} value={rangeEnd} onChange={(event) => onRangeEndChange(event.target.value)} />
      <button type="button" onClick={onZoomToRange}>缩放到区间</button>
      <span className="timeline-tool-separator" />
      <label>位移 <input aria-label="批量帧位移" type="number" step="1" value={moveDelta} onChange={(event) => onMoveDeltaChange(event.target.value)} /></label>
      <button type="button" disabled={!hasSelection} onClick={onMoveSelected}>移动所选</button>
      <label>
        微调
        <select value={adjustProperty} onChange={(event) => onAdjustPropertyChange(event.target.value as NumericProperty)}>
          {NUMERIC_PROPERTIES.map((property) => <option key={property.id} value={property.id}>{property.label}</option>)}
        </select>
      </label>
      <input aria-label="多选关键帧微调量" type="number" step="any" value={adjustDelta} onChange={(event) => onAdjustDeltaChange(event.target.value)} />
      <button type="button" disabled={!hasAdjustHandler || !hasSelection} onClick={onAdjustSelected}>应用微调</button>
    </div>
  );
}
