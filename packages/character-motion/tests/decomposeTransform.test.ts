import { describe, expect, it } from "vitest";
import {
  approximatelyEqual,
  composeAroundPivot,
  decomposeAuthoredTransform,
  multiply,
} from "../src/index.js";

describe("decomposeAuthoredTransform", () => {
  it("round-trips a transform around a non-zero pivot", () => {
    const bind = [1, 0, 0, 1, 4, -2] as const;
    const pivot = { x: 19.2033, y: 34.8422 };
    const authored = composeAroundPivot(2.5, -1.25, -55, 1.2, 0.8, pivot.x, pivot.y);
    const edited = multiply([...bind], authored);
    const result = decomposeAuthoredTransform([...bind], edited, pivot);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(expect.objectContaining({
      x: expect.closeTo(2.5, 8),
      y: expect.closeTo(-1.25, 8),
      rotation: expect.closeTo(-55, 8),
      scaleX: expect.closeTo(1.2, 8),
      scaleY: expect.closeTo(0.8, 8),
    }));
    expect(approximatelyEqual(
      edited,
      multiply(bind, composeAroundPivot(
        result.value.x,
        result.value.y,
        result.value.rotation,
        result.value.scaleX,
        result.value.scaleY,
        pivot.x,
        pivot.y,
      )),
    )).toBe(true);
  });

  it("keeps a reflected bind matrix out of authored values", () => {
    const bind = [-1, 0, 0, 1, 30, 0] as const;
    const pivot = { x: 5, y: 6 };
    const edited = multiply(bind, composeAroundPivot(0, 0, 25, 1, 1, 5, 6));
    const result = decomposeAuthoredTransform([...bind], edited, pivot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rotation).toBeCloseTo(25, 10);
    expect(result.value.scaleX).toBeCloseTo(1, 10);
    expect(result.value.scaleY).toBeCloseTo(1, 10);
  });

  it("rejects skew and singular matrices", () => {
    expect(decomposeAuthoredTransform(
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0.5, 1, 0, 0],
      { x: 0, y: 0 },
    )).toEqual({ ok: false, reason: "skew" });
    expect(decomposeAuthoredTransform(
      [0, 0, 0, 0, 0, 0],
      [1, 0, 0, 1, 0, 0],
      { x: 0, y: 0 },
    )).toEqual({ ok: false, reason: "singular-bind" });
  });
});
