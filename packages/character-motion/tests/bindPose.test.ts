import { describe, expect, it } from "vitest";
import {
  approximatelyEqual,
  computeReparentedBindMatrix,
  resolveWorldBindMatrices,
} from "../src/index";
import type { CharacterRigV1, RigPartV1 } from "../src/types";

function part(
  id: string,
  logicalParentId: string | null,
  bindMatrix: RigPartV1["bindMatrix"],
): RigPartV1 {
  return {
    id,
    sourceBinding: { kind: "elementId", value: id },
    logicalParentId,
    defaultRenderSlot: "body",
    pivot: { x: 0, y: 0, space: "partLocal" },
    bindMatrix,
  };
}

function rig(parts: RigPartV1[]): CharacterRigV1 {
  return {
    schemaVersion: 1,
    rigId: "bind-test",
    artwork: {
      source: "test.svg",
      fingerprint: `sha256:${"0".repeat(64)}`,
      viewBox: [-200, -200, 400, 400],
    },
    renderSlots: ["body"],
    parts,
  };
}

function reparent(
  source: CharacterRigV1,
  partId: string,
  logicalParentId: string | null,
): CharacterRigV1 {
  const result = computeReparentedBindMatrix(source, partId, logicalParentId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return {
    ...source,
    parts: source.parts.map((candidate) => candidate.id === partId
      ? { ...candidate, logicalParentId, bindMatrix: result.bindMatrix }
      : candidate),
  };
}

describe("world bind pose math", () => {
  const complexRig = rig([
    part("root", null, [-1, 0, 0, 1.5, -80, 25]),
    part("branch", "root", [0, 2, -0.5, 0, 15, -20]),
    part("leaf", "branch", [1, 0.25, 0, 0.75, -12, 8]),
    part("other", null, [0.5, 0, 0, -2, 140, -90]),
  ]);

  it("resolves multi-level world bind matrices", () => {
    const worlds = resolveWorldBindMatrices(complexRig);
    expect(worlds.get("root")).toEqual(complexRig.parts[0].bindMatrix);
    expect(worlds.get("leaf")).toEqual([0.125, 3, 0.375, 0, -91, -41]);
  });

  it("preserves a mirrored, non-uniform world bind when changing parent", () => {
    const before = resolveWorldBindMatrices(complexRig).get("leaf")!;
    const changed = reparent(complexRig, "leaf", "other");
    const after = resolveWorldBindMatrices(changed).get("leaf")!;
    expect(approximatelyEqual(after, before, 1e-10)).toBe(true);
  });

  it("preserves world bind when promoting a nested part to root", () => {
    const before = resolveWorldBindMatrices(complexRig).get("branch")!;
    const changed = reparent(complexRig, "branch", null);
    const after = resolveWorldBindMatrices(changed).get("branch")!;
    expect(approximatelyEqual(after, before, 1e-10)).toBe(true);
  });

  it("rejects a descendant parent and a singular parent", () => {
    expect(computeReparentedBindMatrix(complexRig, "root", "leaf"))
      .toEqual({ ok: false, reason: "cycle" });

    const singular = rig([
      part("moving", null, [1, 0, 0, 1, 10, 20]),
      part("singular", null, [0, 0, 0, 1, 0, 0]),
    ]);
    expect(computeReparentedBindMatrix(singular, "moving", "singular"))
      .toEqual({ ok: false, reason: "singular-parent" });
  });
});
