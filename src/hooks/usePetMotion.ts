import { useCallback, useEffect, useRef, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { PET_ANIMATION_CONFIG } from "../config/petAnimation";

type PetElementRef = RefObject<HTMLDivElement | null>;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const px = (value: number) => `${value.toFixed(2)}px`;
const deg = (value: number) => `${value.toFixed(2)}deg`;

export const usePointerFollow = (
  petElement: PetElementRef,
  mode: "local" | "global" = "local",
) => {
  // 全局模式下需要跟踪窗口位置，用于屏幕坐标 → 视口坐标转换
  const winPosRef = useRef({ x: 0, y: 0 });
  const petElementRef = useRef(petElement);
  petElementRef.current = petElement;
  const config = PET_ANIMATION_CONFIG.pointerFollow;

  useEffect(() => {
    let animationFrame: number | undefined;
    let pointerX = 0;
    let pointerY = 0;

    petElementRef.current.current?.style.setProperty(
      "--arm-left-rest-y",
      px(config.arm.leftRestOffsetY),
    );

    const updatePosition = () => {
      animationFrame = undefined;
      const pet = petElementRef.current.current;
      if (!pet) return;

      let localX = pointerX;
      let localY = pointerY;

      // 全局模式下，屏幕坐标 → 视口坐标
      if (mode === "global") {
        localX = pointerX - winPosRef.current.x;
        localY = pointerY - winPosRef.current.y;
      }

      const bounds = pet.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height * 0.34;
      const directionX = clamp(
        (localX - centerX) / config.fullRangeX,
        -1,
        1,
      );
      const directionY = clamp(
        (localY - centerY) / config.fullRangeY,
        -1,
        1,
      );

      const set = (name: string, value: string) =>
        pet.style.setProperty(name, value);

      set("--eye-x", px(directionX * config.eye.maxOffsetX));
      set("--eye-y", px(directionY * config.eye.maxOffsetY));
      set("--brow-x", px(directionX * config.eyebrow.maxOffsetX));
      set("--brow-y", px(directionY * config.eyebrow.maxOffsetY));
      set("--mouth-x", px(directionX * config.mouth.maxOffsetX));
      set("--mouth-y", px(directionY * config.mouth.maxOffsetY));
      set("--rouge-x", px(directionX * config.rouge.maxOffsetX));
      set("--rouge-y", px(directionY * config.rouge.maxOffsetY));
      set("--head-x", px(directionX * config.head.maxOffsetX));
      set(
        "--head-y",
        px(
          directionY *
            (directionY < 0
              ? config.head.maxOffsetUp
              : config.head.maxOffsetDown),
        ),
      );
      set("--head-rotate", deg(directionX * config.head.maxRotateDeg));
      set("--body-x", px(directionX * config.body.maxOffsetX));
      set("--body-y", px(directionY * config.body.maxOffsetY));
      set("--body-rotate", deg(directionX * config.body.maxRotateDeg));
      set("--arm-look-x", px(directionX * config.arm.maxOffsetX));
      set("--arm-look-y", px(directionY * config.arm.maxOffsetY));
      set("--arm-look-rotate", deg(directionX * config.arm.maxRotateDeg));
      set("--tail-look-x", px(directionX * config.hairTail.maxOffsetX));
      set("--tail-look-y", px(directionY * config.hairTail.maxOffsetY));
      set(
        "--tail-look-rotate",
        deg(directionX * config.hairTail.maxRotateDeg),
      );
    };

    if (mode === "global") {
      // 全局模式：监听 Tauri 事件（屏幕绝对坐标）
      const win = getCurrentWindow();

      // 初始获取窗口位置
      win.outerPosition().then((pos) => {
        winPosRef.current = { x: pos.x, y: pos.y };
      });
      // 窗口移动时更新
      let unlistenMove: () => void;
      win.onMoved((event) => {
        winPosRef.current = { x: event.payload.x, y: event.payload.y };
      }).then((fn) => { unlistenMove = fn; });

      const unlistenEvent = listen<{ x: number; y: number }>(
        "global-cursor-move",
        (event) => {
          pointerX = event.payload.x;
          pointerY = event.payload.y;
          if (animationFrame === undefined) {
            animationFrame = window.requestAnimationFrame(updatePosition);
          }
        },
      );

      return () => {
        unlistenEvent.then((fn) => fn());
        if (unlistenMove) unlistenMove();
        if (animationFrame !== undefined) {
          window.cancelAnimationFrame(animationFrame);
        }
      };
    }

    // 本地模式：监听 pointermove（原始行为）
    const handlePointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (animationFrame === undefined) {
        animationFrame = window.requestAnimationFrame(updatePosition);
      }
    };

    petElement.current?.style.setProperty(
      "--look-transition-ms",
      `${config.transitionMs}ms`,
    );
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [petElement, mode, config]);
};

export const useEarTwitch = (petElement: PetElementRef) => {
  const config = PET_ANIMATION_CONFIG.earTwitch;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const leftEar =
      petElement.current?.querySelector<SVGGElement>("#ear-left-motion");
    const rightEar =
      petElement.current?.querySelector<SVGGElement>("#ear-right-motion");
    if (!leftEar || !rightEar) return;

    let timer: number | undefined;
    let animations: Animation[] = [];

    const animateEar = (ear: SVGGElement, direction: -1 | 1) =>
      ear.animate(
        [
          { translate: "0 0", rotate: "0deg", offset: 0 },
          {
            translate: `0 ${-config.maxLiftPx}px`,
            rotate: `${direction * config.maxRotateDeg}deg`,
            offset: 0.3,
          },
          {
            translate: `0 ${-config.maxLiftPx * 0.25}px`,
            rotate: `${direction * config.maxRotateDeg * -0.35}deg`,
            offset: 0.62,
          },
          { translate: "0 0", rotate: "0deg", offset: 1 },
        ],
        { duration: config.durationMs, easing: "ease-in-out" },
      );

    const schedule = () => {
      const delay =
        config.minDelayMs +
        Math.random() * (config.maxDelayMs - config.minDelayMs);
      timer = window.setTimeout(() => {
        animations.forEach((animation) => animation.cancel());
        animations = [animateEar(leftEar, -1), animateEar(rightEar, 1)];
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
    };
  }, [petElement, config]);
};

interface SpringAxis {
  position: number;
  velocity: number;
  target: number;
}

interface DragSample {
  x: number;
  y: number;
  time: number;
}

export const useTailInertia = (petElement: PetElementRef) => {
  const frame = useRef<number | undefined>(undefined);
  const previousFrameTime = useRef<number | undefined>(undefined);
  const lastDragSample = useRef<DragSample | null>(null);
  const xAxis = useRef<SpringAxis>({ position: 0, velocity: 0, target: 0 });
  const yAxis = useRef<SpringAxis>({ position: 0, velocity: 0, target: 0 });
  const rotationAxis = useRef<SpringAxis>({
    position: 0,
    velocity: 0,
    target: 0,
  });

  const writeMotion = useCallback(() => {
    const pet = petElement.current;
    if (!pet) return;
    const config = PET_ANIMATION_CONFIG.tailInertia;
    pet.style.setProperty("--tail-inertia-x", px(xAxis.current.position));
    pet.style.setProperty("--tail-inertia-y", px(yAxis.current.position));
    pet.style.setProperty(
      "--tail-left-inertia-rotate",
      deg(rotationAxis.current.position),
    );
    pet.style.setProperty(
      "--tail-right-inertia-rotate",
      deg(rotationAxis.current.position * config.rightTailRotationRatio),
    );
  }, [petElement]);

  const step = useCallback(
    (time: number) => {
      const config = PET_ANIMATION_CONFIG.tailInertia;
      const previous = previousFrameTime.current ?? time;
      const deltaSeconds = Math.min((time - previous) / 1000, 0.033);
      previousFrameTime.current = time;
      const decay = Math.exp(-config.targetDecayPerSecond * deltaSeconds);
      const velocityDamping = Math.exp(-config.damping * deltaSeconds);
      let isMoving = false;

      for (const axis of [xAxis.current, yAxis.current, rotationAxis.current]) {
        axis.target *= decay;
        axis.velocity +=
          (axis.target - axis.position) * config.stiffness * deltaSeconds;
        axis.velocity *= velocityDamping;
        axis.position += axis.velocity * deltaSeconds;
        if (
          Math.abs(axis.position) > 0.005 ||
          Math.abs(axis.velocity) > 0.005 ||
          Math.abs(axis.target) > 0.005
        ) {
          isMoving = true;
        } else {
          axis.position = 0;
          axis.velocity = 0;
          axis.target = 0;
        }
      }

      writeMotion();
      if (isMoving) {
        frame.current = window.requestAnimationFrame(step);
      } else {
        frame.current = undefined;
        previousFrameTime.current = undefined;
      }
    },
    [writeMotion],
  );

  const ensureAnimation = useCallback(() => {
    if (frame.current === undefined) {
      previousFrameTime.current = undefined;
      frame.current = window.requestAnimationFrame(step);
    }
  }, [step]);

  const startDrag = useCallback((x: number, y: number, time: number) => {
    lastDragSample.current = { x, y, time };
  }, []);

  const sampleDrag = useCallback(
    (x: number, y: number, time: number) => {
      const previous = lastDragSample.current;
      lastDragSample.current = { x, y, time };
      if (!previous) return;

      const config = PET_ANIMATION_CONFIG.tailInertia;
      const deltaMs = clamp(time - previous.time, 8, 64);
      const velocityX = (x - previous.x) / deltaMs;
      const velocityY = (y - previous.y) / deltaMs;
      const normalizedX = clamp(
        velocityX / config.velocityForMaxPxPerMs,
        -1,
        1,
      );
      const normalizedY = clamp(
        velocityY / config.velocityForMaxPxPerMs,
        -1,
        1,
      );

      xAxis.current.target = -normalizedX * config.maxOffsetX;
      yAxis.current.target = -normalizedY * config.maxOffsetY;
      rotationAxis.current.target = -normalizedX * config.maxRotateDeg;
      ensureAnimation();
    },
    [ensureAnimation],
  );

  const release = useCallback(() => {
    lastDragSample.current = null;
    xAxis.current.target = 0;
    yAxis.current.target = 0;
    rotationAxis.current.target = 0;
    ensureAnimation();
  }, [ensureAnimation]);

  useEffect(
    () => () => {
      if (frame.current !== undefined) {
        window.cancelAnimationFrame(frame.current);
      }
    },
    [],
  );

  return { startDrag, sampleDrag, release };
};
