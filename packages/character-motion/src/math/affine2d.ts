/**
 * Pure 2D affine transformation math using 6-tuple matrices.
 * All functions are pure — no mutation of inputs.
 * No DOMMatrix, no external dependencies.
 */

import type {
  AffineMatrix,
  TransformDecompositionResult,
} from "../types.js";

// ─── Helpers ────────────────────────────────────────────────────

/** Normalize -0 to 0 for clean output. */
function normalizeZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

function normalizeMatrix(m: AffineMatrix): AffineMatrix {
  return [
    normalizeZero(m[0]),
    normalizeZero(m[1]),
    normalizeZero(m[2]),
    normalizeZero(m[3]),
    normalizeZero(m[4]),
    normalizeZero(m[5]),
  ];
}

// ─── Constants ──────────────────────────────────────────────────

const EPSILON = 1e-12;

// ─── Factory ────────────────────────────────────────────────────

/** Returns the identity matrix [1, 0, 0, 1, 0, 0]. */
export function identity(): AffineMatrix {
  return [1, 0, 0, 1, 0, 0];
}

/** Creates a translation matrix. */
export function translate(x: number, y: number): AffineMatrix {
  return normalizeMatrix([1, 0, 0, 1, x, y]);
}

/** Creates a rotation matrix from an angle in degrees. */
export function rotateDegrees(angle: number): AffineMatrix {
  const rad = (angle * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    normalizeZero(c),
    normalizeZero(s),
    normalizeZero(-s),
    normalizeZero(c),
    0,
    0,
  ];
}

/** Creates a non-uniform scale matrix. */
export function scale(x: number, y: number): AffineMatrix {
  return normalizeMatrix([x, 0, 0, y, 0, 0]);
}

// ─── Composition ────────────────────────────────────────────────

/**
 * Multiplies two affine matrices: result = left × right.
 * Matrix multiplication is NOT commutative.
 */
export function multiply(
  left: AffineMatrix,
  right: AffineMatrix,
): AffineMatrix {
  return normalizeMatrix([
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]);
}

// ─── Inversion ──────────────────────────────────────────────────

/**
 * Inverts an affine matrix. Returns null if the matrix is singular
 * (determinant absolute value < 1e-12).
 */
export function invert(m: AffineMatrix): AffineMatrix | null {
  const det = determinant(m);
  if (Math.abs(det) < EPSILON) {
    return null;
  }
  const invDet = 1 / det;
  return normalizeMatrix([
    m[3] * invDet,
    -m[1] * invDet,
    -m[2] * invDet,
    m[0] * invDet,
    (m[2] * m[5] - m[3] * m[4]) * invDet,
    (m[1] * m[4] - m[0] * m[5]) * invDet,
  ]);
}

// ─── Determinant ────────────────────────────────────────────────

/** Computes the determinant of an affine matrix. */
export function determinant(m: AffineMatrix): number {
  return m[0] * m[3] - m[1] * m[2];
}

// ─── Point Transformation ───────────────────────────────────────

/** Transforms a 2D point by an affine matrix: result = M × point. */
export function transformPoint(
  m: AffineMatrix,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: normalizeZero(m[0] * point.x + m[2] * point.y + m[4]),
    y: normalizeZero(m[1] * point.x + m[3] * point.y + m[5]),
  };
}

// ─── Comparison ─────────────────────────────────────────────────

/** Checks if two affine matrices are approximately equal within an epsilon. */
export function approximatelyEqual(
  a: AffineMatrix,
  b: AffineMatrix,
  epsilon: number = 1e-9,
): boolean {
  for (let i = 0; i < 6; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) {
      return false;
    }
  }
  return true;
}

// ─── Pivot Composition ──────────────────────────────────────────

/**
 * Composes a transform around a pivot point.
 * Equivalent to: T(pivot) × R × S × T(-pivot)
 * where R is rotation and S is scale.
 *
 * @param tx - translation x
 * @param ty - translation y
 * @param rot - rotation in degrees
 * @param sx - scale x
 * @param sy - scale y
 * @param px - pivot x (local space)
 * @param py - pivot y (local space)
 * @returns Combined affine matrix
 */
export function composeAroundPivot(
  tx: number,
  ty: number,
  rot: number,
  sx: number,
  sy: number,
  px: number,
  py: number,
): AffineMatrix {
  // T(tx,ty) × T(px,py) × R(rot) × S(sx,sy) × T(-px,-py)
  const t1 = translate(tx, ty);
  const tPivot = translate(px, py);
  const r = rotateDegrees(rot);
  const s = scale(sx, sy);
  const tNegPivot = translate(-px, -py);

  // Compose right-to-left: T1 × Tpivot × R × S × TnegPivot
  let result = multiply(s, tNegPivot);
  result = multiply(r, result);
  result = multiply(tPivot, result);
  result = multiply(t1, result);

  return result;
}

/**
 * Decomposes an edited local matrix back into the authored channels used by
 * `composeAroundPivot`. The bind matrix is removed first, so reflected or
 * translated artwork does not leak into authored keyframes.
 *
 * The v1 motion format deliberately has no skew channel. Matrices containing
 * skew are rejected instead of being approximated and drifting on round-trip.
 */
export function decomposeAuthoredTransform(
  bindMatrix: AffineMatrix,
  editedLocalMatrix: AffineMatrix,
  pivot: { x: number; y: number },
  tolerance = 1e-8,
): TransformDecompositionResult {
  if (
    ![...bindMatrix, ...editedLocalMatrix, pivot.x, pivot.y, tolerance]
      .every(Number.isFinite)
  ) {
    return { ok: false, reason: "non-finite" };
  }

  const inverseBind = invert(bindMatrix);
  if (!inverseBind) return { ok: false, reason: "singular-bind" };

  const authored = multiply(inverseBind, editedLocalMatrix);
  const [a, b, c, d, e, f] = authored;
  const scaleX = Math.hypot(a, b);
  const secondColumnLength = Math.hypot(c, d);
  if (scaleX < EPSILON || secondColumnLength < EPSILON) {
    return { ok: false, reason: "singular-transform" };
  }

  const normalizedDot = (a * c + b * d) / (scaleX * secondColumnLength);
  if (Math.abs(normalizedDot) > tolerance) {
    return { ok: false, reason: "skew" };
  }

  const det = determinant(authored);
  if (Math.abs(det) < EPSILON) return { ok: false, reason: "singular-transform" };

  const scaleY = det / scaleX;
  let rotation = Math.atan2(b, a) * 180 / Math.PI;
  if (rotation > 180) rotation -= 360;
  if (rotation <= -180) rotation += 360;

  // e = x + px - a*px - c*py (and the equivalent equation for y).
  const x = e - pivot.x + a * pivot.x + c * pivot.y;
  const y = f - pivot.y + b * pivot.x + d * pivot.y;

  const value = {
    x: normalizeZero(x),
    y: normalizeZero(y),
    rotation: normalizeZero(rotation),
    scaleX: normalizeZero(scaleX),
    scaleY: normalizeZero(scaleY),
  };
  return Object.values(value).every(Number.isFinite)
    ? { ok: true, value }
    : { ok: false, reason: "non-finite" };
}
