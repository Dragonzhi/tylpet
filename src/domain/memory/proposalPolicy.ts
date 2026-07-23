import type { MemoryProposalMode } from "../settings/types";

/** 只识别用户当前消息中明确表达的记忆意图，不读取模型输出。 */
export function isExplicitMemoryRequest(content: string): boolean {
  return /(?:请|帮我)?记住|记一下|以后要记得|\bremember\b/iu.test(content);
}

/** 模型自主提议始终确认；只有用户主动选择的显式自动模式可跳过一次确认。 */
export function memoryProposalRequiresConfirmation(
  mode: MemoryProposalMode,
  userMessage: string,
): boolean {
  return mode !== "explicit-auto" || !isExplicitMemoryRequest(userMessage);
}
