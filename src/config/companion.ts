/** Preview.3 本地陪伴导演的时间预算；所有数值单位均为毫秒。 */
export const COMPANION_CONFIG = {
  /** 角色正忙时只做短暂退避，不把空闲动作排入队列。 */
  busyRetryMs: 30_000,
  /** 当前角色没有任何可用动作时的再次探测间隔。 */
  unavailableRetryMs: 5 * 60_000,
  /** 唤醒计时器明显晚于目标时视为系统休眠恢复，不补播错过的动作。 */
  suspensionOvershootMs: 60_000,
  /** 同一动作至少间隔这么久，避免现有少量 Clip 显得机械重复。 */
  sameMotionCooldownMs: 20 * 60_000,
  /** 每小时次数预算使用的滚动窗口。 */
  budgetWindowMs: 60 * 60_000,
  mode: {
    companion: {
      graceMs: 120_000,
      maxActionsPerWindow: 6,
      intervalMs: {
        low: { minimum: 8 * 60_000, maximum: 15 * 60_000 },
        normal: { minimum: 4 * 60_000, maximum: 9 * 60_000 },
      },
    },
    focus: {
      graceMs: 180_000,
      maxActionsPerWindow: 3,
      intervalMs: {
        low: { minimum: 18 * 60_000, maximum: 30 * 60_000 },
        normal: { minimum: 12 * 60_000, maximum: 20 * 60_000 },
      },
    },
  },
} as const;
