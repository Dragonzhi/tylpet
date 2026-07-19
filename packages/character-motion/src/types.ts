/**
 * Core type definitions for the character-motion package.
 * Pure TypeScript — no React, DOM, or Tauri dependencies.
 */

// ─── Math Primitives ────────────────────────────────────────────

/**
 * 2D affine transformation matrix stored as a 6-tuple `[a, b, c, d, e, f]`
 * representing the matrix:
 * ```
 * | a  c  e |
 * | b  d  f |
 * | 0  0  1 |
 * ```
 * where (a,b,c,d) is the linear part and (e,f) is the translation.
 */
export type AffineMatrix = [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

// ─── Transform ──────────────────────────────────────────────────

/**
 * Authored transform values for a single part at a given point in time.
 * All values default to 0 (for x/y/rotation) or 1 (for scale/opacity)
 * when not present in keyframes.
 */
export interface TransformValue {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

/** Numeric transform channels that can be represented without skew. */
export interface AuthoredTransformValue {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export type TransformDecompositionResult =
  | { ok: true; value: AuthoredTransformValue }
  | { ok: false; reason: "singular-bind" | "singular-transform" | "skew" | "non-finite" };

// ─── Easing ─────────────────────────────────────────────────────

/**
 * Easing function selector.
 * Preset strings map to baked easings; cubicBezier provides a custom
 * cubic bezier curve with control points in the 0..1 range.
 */
export type EasingValue =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | { cubicBezier: [number, number, number, number] };

// ─── Procedural Channels ────────────────────────────────────────

/**
 * Procedural animation channels that can be suppressed for a motion clip.
 */
export type ProceduralChannel =
  | "breathing"
  | "blinking"
  | "pointer-follow"
  | "hair-physics"
  | "ear-twitch";

// ─── Source Binding ─────────────────────────────────────────────

export interface SourceBinding {
  kind: "inkscapeLabel" | "elementId" | "dataPart";
  value: string;
}

// ─── Pivot ──────────────────────────────────────────────────────

export interface PivotPoint {
  x: number;
  y: number;
  space: "partLocal";
}

// ─── Rig Part ───────────────────────────────────────────────────

export interface RigPartV1 {
  id: string;
  sourceBinding: SourceBinding;
  logicalParentId: string | null;
  defaultRenderSlot: string;
  pivot: PivotPoint;
  bindMatrix: AffineMatrix;
  tags?: string[];
}

// ─── Artwork Reference ──────────────────────────────────────────

export interface ArtworkReference {
  source: string;
  fingerprint: string;
  viewBox: [number, number, number, number];
}

// ─── Character Rig V1 ───────────────────────────────────────────

export interface CharacterRigV1 {
  schemaVersion: 1;
  rigId: string;
  artwork: ArtworkReference;
  renderSlots: string[];
  parts: RigPartV1[];
}

// ─── Motion Keyframe ────────────────────────────────────────────

export interface MotionKeyframeV1 {
  frame: number;
  values: Partial<TransformValue> & { renderSlot?: string };
  easing?: EasingValue;
}

// ─── Part Track ─────────────────────────────────────────────────

export interface PartTrackV1 {
  partId: string;
  keyframes: MotionKeyframeV1[];
}

// ─── Motion Event Types ─────────────────────────────────────────

export type MotionEventType =
  | "blink"
  | "mouthOpen"
  | "mouthClose"
  | "sfx"
  | "custom";

// ─── Motion Event ───────────────────────────────────────────────

export interface MotionEventV1 {
  frame: number;
  type: MotionEventType;
  payload?: Record<string, string | number | boolean>;
}

// ─── Motion Clip V1 ─────────────────────────────────────────────

export interface MotionClipV1 {
  id: string;
  fps: number;
  durationFrames: number;
  loop: "none" | "repeat";
  tracks: PartTrackV1[];
  events: MotionEventV1[];
  suppressProceduralChannels?: ProceduralChannel[];
}

// ─── Motion Library V1 ──────────────────────────────────────────

export interface MotionLibraryV1 {
  schemaVersion: 1;
  rigId: string;
  clips: MotionClipV1[];
}

// ─── Validation ─────────────────────────────────────────────────

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warn";
}

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };
