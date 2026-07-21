/**
 * @ltypet/character-motion public API.
 * Only exports from this barrel — internal modules must NOT be imported by consumers.
 */

// Types
export type {
  AffineMatrix,
  TransformValue,
  AuthoredTransformValue,
  TransformDecompositionResult,
  EasingValue,
  ProceduralChannel,
  SourceBinding,
  PivotPoint,
  RigPartV1,
  ArtworkReference,
  CharacterRigV1,
  MotionKeyframeV1,
  PartTrackV1,
  MotionEventType,
  MotionEventV1,
  MotionClipV1,
  MotionLibraryV1,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

// Math
export {
  identity,
  multiply,
  invert,
  translate,
  rotateDegrees,
  scale,
  transformPoint,
  determinant,
  approximatelyEqual,
  composeAroundPivot,
  decomposeAuthoredTransform,
  computePivotInPartLocal,
} from "./math/index.js";

// Timeline
export {
  applyEasing,
  frameToTime,
  timeToFrame,
  wrapFrame,
  samplePropertyAtFrame,
  sampleRenderSlotAtFrame,
  sampleMotionClip,
} from "./timeline/index.js";

// Rig
export {
  topologicalOrder,
  resolveWorldPose,
  resolveAllPoses,
  computeReparentedBindMatrix,
  resolveWorldBindMatrices,
} from "./rig/index.js";
export type { ReparentBindMatrixResult } from "./rig/index.js";

// Serialization
export {
  canonicalizeArtworkText,
  canonicalizeRig,
  canonicalizeMotionLibrary,
  serializeRig,
  serializeMotionLibrary,
  sha256CanonicalText,
} from "./serialization/index.js";

// Migration
export { migrateP0ToV1 } from "./migration/index.js";
export type { P0ExperimentalProject } from "./migration/index.js";

// Schema / Validation
export {
  validateRig,
  validateMotionLibrary,
  validateRigStructure,
  validateMotionsStructure,
  validateRigSemantics,
  validateMotionSemantics,
} from "./schema/index.js";
