import { useRef } from "react";
import type { TransformValue } from "@ltypet/character-motion";
import type { PartScreenGeometry } from "../../svgcanvas/SvgCanvasAdapter";

interface Props {
  geometry: PartScreenGeometry | null;
  partId: string | null;
  transform: TransformValue | null;
  pivot: { x: number; y: number } | null;
  hasKeyframe: boolean;
  locked: boolean;
  tool: "select" | "pivot";
  stageElement: HTMLElement | null;
  screenDeltaToSvg(deltaX: number, deltaY: number): { x: number; y: number } | null;
  screenDeltaToPartLocal(partId: string, deltaX: number, deltaY: number): { x: number; y: number } | null;
  onTransformPreview(value: TransformValue): void;
  onTransformCommit(value: TransformValue): void;
  onPivotPreview(x: number, y: number): void;
  onPivotCommit(x: number, y: number): void;
  onCancel(): void;
  onNeedsKeyframe(): void;
}

type Gesture = {
  kind: "move" | "rotate" | "scale" | "scaleX" | "scaleY" | "pivot";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startAngle: number;
  startDistance: number;
  startProjection: number;
  transform: TransformValue;
  pivot: { x: number; y: number };
  latestTransform: TransformValue;
  latestPivot: { x: number; y: number };
};

export function TransformGizmo({
  geometry,
  partId,
  transform,
  pivot,
  hasKeyframe,
  locked,
  tool,
  stageElement,
  screenDeltaToSvg,
  screenDeltaToPartLocal,
  onTransformPreview,
  onTransformCommit,
  onPivotPreview,
  onPivotCommit,
  onCancel,
  onNeedsKeyframe,
}: Props) {
  const gestureRef = useRef<Gesture | null>(null);
  if (!geometry || !partId || !transform || !pivot || locked) return null;

  const pivotClient = () => {
    const rect = stageElement?.getBoundingClientRect();
    return rect ? { x: rect.left + geometry.pivot.x, y: rect.top + geometry.pivot.y } : null;
  };

  const begin = (kind: Gesture["kind"], event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (kind !== "pivot" && !hasKeyframe) {
      onNeedsKeyframe();
      return;
    }
    const center = pivotClient();
    if (!center) return;
    const dx = event.clientX - center.x;
    const dy = event.clientY - center.y;
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startAngle: Math.atan2(dy, dx),
      startDistance: Math.max(1, Math.hypot(dx, dy)),
      startProjection: kind === "scaleX"
        ? dx * geometry.axisX.x + dy * geometry.axisX.y
        : dx * geometry.axisY.x + dy * geometry.axisY.y,
      transform: { ...transform },
      pivot: { ...pivot },
      latestTransform: { ...transform },
      latestPivot: { ...pivot },
    };
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startClientX;
    const dy = event.clientY - gesture.startClientY;
    if (gesture.kind === "move") {
      const delta = screenDeltaToSvg(dx, dy);
      if (delta) {
        gesture.latestTransform = { ...gesture.transform, x: gesture.transform.x + delta.x, y: gesture.transform.y + delta.y };
        onTransformPreview(gesture.latestTransform);
      }
    } else if (gesture.kind === "rotate") {
      const center = pivotClient();
      if (!center) return;
      const angle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
      gesture.latestTransform = { ...gesture.transform, rotation: gesture.transform.rotation + (angle - gesture.startAngle) * 180 / Math.PI };
      onTransformPreview(gesture.latestTransform);
    } else if (gesture.kind === "scale") {
      const center = pivotClient();
      if (!center) return;
      const ratio = Math.max(0.01, Math.hypot(event.clientX - center.x, event.clientY - center.y) / gesture.startDistance);
      gesture.latestTransform = { ...gesture.transform, scaleX: gesture.transform.scaleX * ratio, scaleY: gesture.transform.scaleY * ratio };
      onTransformPreview(gesture.latestTransform);
    } else if (gesture.kind === "scaleX" || gesture.kind === "scaleY") {
      const center = pivotClient();
      if (!center) return;
      const axis = gesture.kind === "scaleX" ? geometry.axisX : geometry.axisY;
      const projection = (event.clientX - center.x) * axis.x + (event.clientY - center.y) * axis.y;
      const divisor = Math.abs(gesture.startProjection) < 1 ? 1 : gesture.startProjection;
      const ratio = Math.max(0.01, projection / divisor);
      gesture.latestTransform = gesture.kind === "scaleX"
        ? { ...gesture.transform, scaleX: gesture.transform.scaleX * ratio }
        : { ...gesture.transform, scaleY: gesture.transform.scaleY * ratio };
      onTransformPreview(gesture.latestTransform);
    } else {
      const delta = screenDeltaToPartLocal(partId, dx, dy);
      if (delta) {
        gesture.latestPivot = { x: gesture.pivot.x + delta.x, y: gesture.pivot.y + delta.y };
        onPivotPreview(gesture.latestPivot.x, gesture.latestPivot.y);
      }
    }
  };

  const finish = () => {
    const gesture = gestureRef.current;
    if (gesture) {
      if (gesture.kind === "pivot") onPivotCommit(gesture.latestPivot.x, gesture.latestPivot.y);
      else onTransformCommit(gesture.latestTransform);
    }
    gestureRef.current = null;
  };

  const cancel = () => {
    gestureRef.current = null;
    onCancel();
  };

  const common = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: cancel,
  };

  return (
    <div className="transform-gizmo" aria-label="舞台变换手柄">
      <div
        className="gizmo-bounds"
        style={geometry.bounds}
        onPointerDown={(event) => begin("move", event)}
        {...common}
      />
      <div
        className="gizmo-pivot"
        style={{ left: geometry.pivot.x, top: geometry.pivot.y }}
        title={tool === "pivot" ? "拖动修改 pivot" : "真实 pivot"}
        onPointerDown={(event) => begin(tool === "pivot" ? "pivot" : "move", event)}
        {...common}
      />
      {tool === "select" && (
        <>
          <div className="gizmo-rotation-line" style={{ left: geometry.pivot.x, top: geometry.pivot.y }} />
          <button
            type="button"
            className="gizmo-handle rotate"
            style={{ left: geometry.pivot.x, top: geometry.pivot.y - 42 }}
            aria-label="旋转所选 Part"
            onPointerDown={(event) => begin("rotate", event)}
            {...common}
          />
          <button
            type="button"
            className="gizmo-handle scale"
            style={{ left: geometry.bounds.left + geometry.bounds.width, top: geometry.bounds.top + geometry.bounds.height }}
            aria-label="等比缩放所选 Part"
            onPointerDown={(event) => begin("scale", event)}
            {...common}
          />
          <button
            type="button"
            className="gizmo-handle scale-x"
            style={{
              left: geometry.pivot.x + geometry.axisX.x * 54,
              top: geometry.pivot.y + geometry.axisX.y * 54,
            }}
            aria-label="水平缩放所选 Part"
            onPointerDown={(event) => begin("scaleX", event)}
            {...common}
          />
          <button
            type="button"
            className="gizmo-handle scale-y"
            style={{
              left: geometry.pivot.x + geometry.axisY.x * 54,
              top: geometry.pivot.y + geometry.axisY.y * 54,
            }}
            aria-label="垂直缩放所选 Part"
            onPointerDown={(event) => begin("scaleY", event)}
            {...common}
          />
        </>
      )}
    </div>
  );
}
