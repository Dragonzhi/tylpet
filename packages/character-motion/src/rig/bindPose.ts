import type { AffineMatrix, CharacterRigV1 } from "../types.js";
import { approximatelyEqual, invert, multiply } from "../math/affine2d.js";
import { topologicalOrder } from "./dependencyGraph.js";

export type ReparentBindMatrixResult =
  | { ok: true; bindMatrix: AffineMatrix }
  | {
      ok: false;
      reason:
        | "part-not-found"
        | "parent-not-found"
        | "cycle"
        | "singular-parent"
        | "non-finite"
        | "recomposition-error";
    };

/** Resolves every part's frame-zero world bind matrix. */
export function resolveWorldBindMatrices(
  rig: CharacterRigV1,
): Map<string, AffineMatrix> {
  const worldMatrices = new Map<string, AffineMatrix>();

  for (const part of topologicalOrder(rig.parts)) {
    if (part.logicalParentId === null) {
      worldMatrices.set(part.id, [...part.bindMatrix]);
      continue;
    }

    const parentWorld = worldMatrices.get(part.logicalParentId);
    if (!parentWorld) {
      throw new Error(
        `Parent "${part.logicalParentId}" not resolved for part "${part.id}"`,
      );
    }
    worldMatrices.set(part.id, multiply(parentWorld, part.bindMatrix));
  }

  return worldMatrices;
}

/**
 * Computes the local bind matrix for a new logical parent while preserving the
 * part's frame-zero world bind pose.
 */
export function computeReparentedBindMatrix(
  rig: CharacterRigV1,
  partId: string,
  newParentId: string | null,
  tolerance = 1e-9,
): ReparentBindMatrixResult {
  const part = rig.parts.find((candidate) => candidate.id === partId);
  if (!part) return { ok: false, reason: "part-not-found" };

  if (newParentId !== null) {
    if (!rig.parts.some((candidate) => candidate.id === newParentId)) {
      return { ok: false, reason: "parent-not-found" };
    }
    const visited = new Set<string>();

    let ancestorId: string | null = newParentId;
    while (ancestorId !== null) {
      if (visited.has(ancestorId)) return { ok: false, reason: "cycle" };
      visited.add(ancestorId);
      if (ancestorId === partId) return { ok: false, reason: "cycle" };
      ancestorId = rig.parts.find((candidate) => candidate.id === ancestorId)
        ?.logicalParentId ?? null;
    }
  }

  let worldMatrices: Map<string, AffineMatrix>;
  try {
    worldMatrices = resolveWorldBindMatrices(rig);
  } catch {
    return { ok: false, reason: "cycle" };
  }

  const oldWorld = worldMatrices.get(partId);
  if (!oldWorld) return { ok: false, reason: "part-not-found" };

  let bindMatrix: AffineMatrix;
  let recomposed: AffineMatrix;
  if (newParentId === null) {
    bindMatrix = [...oldWorld];
    recomposed = bindMatrix;
  } else {
    const parentWorld = worldMatrices.get(newParentId);
    if (!parentWorld) return { ok: false, reason: "parent-not-found" };
    const inverseParent = invert(parentWorld);
    if (!inverseParent) return { ok: false, reason: "singular-parent" };
    bindMatrix = multiply(inverseParent, oldWorld);
    recomposed = multiply(parentWorld, bindMatrix);
  }

  if (![...bindMatrix, ...recomposed].every(Number.isFinite)) {
    return { ok: false, reason: "non-finite" };
  }
  if (!approximatelyEqual(recomposed, oldWorld, tolerance)) {
    return { ok: false, reason: "recomposition-error" };
  }

  return { ok: true, bindMatrix };
}
