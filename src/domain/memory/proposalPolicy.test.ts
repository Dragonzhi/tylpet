import { describe, expect, it } from "vitest";
import { isExplicitMemoryRequest, memoryProposalRequiresConfirmation } from "./proposalPolicy";

describe("memory proposal policy", () => {
  it("recognizes explicit Chinese and English memory requests", () => {
    expect(isExplicitMemoryRequest("请记住我不喜欢香菜")).toBe(true);
    expect(isExplicitMemoryRequest("Remember that I prefer tea")).toBe(true);
    expect(isExplicitMemoryRequest("我今天吃了香菜")).toBe(false);
  });

  it("always confirms autonomous proposals in confirm mode", () => {
    expect(memoryProposalRequiresConfirmation("confirm", "请记住我的生日")).toBe(true);
    expect(memoryProposalRequiresConfirmation("confirm", "普通聊天")).toBe(true);
  });

  it("skips confirmation only for explicit requests in explicit-auto mode", () => {
    expect(memoryProposalRequiresConfirmation("explicit-auto", "帮我记住我喜欢绿茶")).toBe(false);
    expect(memoryProposalRequiresConfirmation("explicit-auto", "我喜欢绿茶")).toBe(true);
  });
});
