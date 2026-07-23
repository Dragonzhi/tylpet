import type { AgentToolExecution } from "../agent/types";

const TOOL_NAMES: Readonly<Record<string, string>> = {
  pet_play_motion: "播放角色动作",
  pet_set_expression: "切换角色表情",
  pet_set_look: "调整视线",
  pet_move_window: "移动桌宠",
  pet_say: "本机语音朗读",
  memory_propose: "保存长期记忆",
  timer_start: "开始计时",
  timer_pause: "暂停计时",
  timer_resume: "继续计时",
  timer_cancel: "取消计时",
};

export function toolDisplayName(name: string): string {
  return TOOL_NAMES[name] ?? "执行工具";
}

export function insertBeforeItem<T extends { id: string }>(
  items: readonly T[],
  beforeId: string,
  item: T,
): T[] {
  const index = items.findIndex((candidate) => candidate.id === beforeId);
  if (index < 0) return [...items, item];
  return [...items.slice(0, index), item, ...items.slice(index)];
}

/** 工具型回复没有最终文本时，生成可见且可进入短期会话的确定性收尾。 */
export function summarizeToolOnlyTurn(executions: readonly AgentToolExecution[]): string {
  if (executions.length === 0) return "（模型没有返回文本内容）";
  const failures = executions.filter((execution) => execution.result.status !== "completed");
  if (failures.length === 0) {
    return executions.length === 1
      ? `${toolDisplayName(executions[0].toolCall.function.name)}已完成。`
      : `${executions.length} 项操作已完成。`;
  }
  const first = failures[0];
  const reason = first.result.reason ?? first.result.errorCode ?? first.result.status;
  return failures.length === executions.length
    ? `这次操作没有完成：${reason}`
    : `部分操作已完成，另有 ${failures.length} 项未完成：${reason}`;
}
