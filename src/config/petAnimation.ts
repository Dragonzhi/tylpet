export const PET_ANIMATION_CONFIG = {
  /** 鼠标位置驱动的分层跟随。所有 maxOffset 均为 CSS 像素。 */
  pointerFollow: {
    // 鼠标距离角色中心达到此值时，对应方向的动作幅度达到上限。
    fullRangeX: 150,
    fullRangeY: 120,
    // CSS 跟随补间时间；越大越柔和，但也会更迟钝。
    transitionMs: 110,
    // 眼睛是最直接的视线反馈。
    eye: { maxOffsetX: 0.6, maxOffsetY: 0.75 },
    // 眉毛、嘴和腮红只做小幅二级视差，避免五官显得僵硬。
    eyebrow: { maxOffsetX: 0.28, maxOffsetY: 0.2 },
    mouth: { maxOffsetX: 0.14, maxOffsetY: 0.1 },
    rouge: { maxOffsetX: 0.1, maxOffsetY: 0.07 },
    // 头部探出幅度最大；上下独立配置，旋转中心使用 SVG 中的 pivot_head。
    head: {
      maxOffsetX: 1.8,
      maxOffsetUp: 0.55,
      maxOffsetDown: 0.8,
      maxRotateDeg: 2.2,
    },
    // 身体只做克制的倾斜，双腿始终固定不参与跟随。
    body: { maxOffsetX: 0.55, maxOffsetY: 0.3, maxRotateDeg: 0.75 },
    // 双臂使用动作外层跟随；leftRestOffsetY 用于校准素材的静态高度差。
    arm: {
      maxOffsetX: 0.7,
      maxOffsetY: 0.38,
      maxRotateDeg: 0.45,
      leftRestOffsetY: -0.35,
    },
    // 马尾的鼠标视差；拖动惯性会在此基础上继续叠加。
    hairTail: { maxOffsetX: 0.9, maxOffsetY: 0.5, maxRotateDeg: 1 },
  },
  /** 拖动速度驱动的双马尾阻尼弹簧。位移单位 px，速度单位 px/ms。 */
  tailInertia: {
    // 快速拖动时允许达到的最大反向滞后距离和旋转角度。
    maxOffsetX: 5,
    maxOffsetY: 2.2,
    maxRotateDeg: 7,
    // 达到最大惯性幅度所需的鼠标速度；越小越容易甩动。
    velocityForMaxPxPerMs: 1.1,
    // stiffness 越大回弹越快，damping 越大回摆次数越少。
    stiffness: 125,
    damping: 15,
    // 拖动速度停止后，惯性目标每秒衰减速度。
    targetDecayPerSecond: 9,
    // 右马尾相对左马尾的旋转比例，避免两边完全机械同步。
    rightTailRotationRatio: 0.9,
  },
  /** 双耳同步随机微动；间隔和持续时间单位 ms，位移单位 px。 */
  earTwitch: {
    // 每次动作结束后，在此随机区间内等待下一次微动。
    minDelayMs: 8_000,
    maxDelayMs: 16_000,
    durationMs: 620,
    // 耳朵上提距离和向外转动角度上限。
    maxLiftPx: 0.25,
    maxRotateDeg: 3,
  },
} as const;
