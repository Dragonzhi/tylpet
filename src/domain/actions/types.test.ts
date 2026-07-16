import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./types";

describe("协议版本", () => {
  it("协议版本为 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
