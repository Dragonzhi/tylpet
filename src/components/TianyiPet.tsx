import { useEffect, useRef, useState } from "react";
import TianyiArtwork, {
  type PetAction,
  type PetExpression,
} from "./TianyiArtwork";

// 天依的核心动画状态
type PetState = "idle" | "blink" | "listen" | "speak" | "sleep" | "drag";

// 视线跟随参数集中在这里调整。maxOffset 越小，眼睛移动范围越克制。
const EYE_TRACKING_CONFIG = {
  maxOffsetX: 0.6,
  maxOffsetY: 0.35,
  fullRangeX: 150,
  fullRangeY: 120,
} as const;

const getExpression = (state: PetState): PetExpression => {
  if (state === "blink") return "blink";
  if (state === "speak") return "speak";
  if (state === "sleep") return "sleep";
  return "normal";
};

const TianyiPet = () => {
  const [state, setState] = useState<PetState>("idle");
  const [action, setAction] = useState<PetAction>("none");
  const [isDragging, setIsDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const petElement = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const restoreStateTimer = useRef<number | undefined>(undefined);

  // idle 动画循环 — 随机眨眼，并在短暂动作结束后恢复原状态。
  useEffect(() => {
    if (state !== "idle" && state !== "listen") return;

    const restingState = state;
    const blinkTimer = window.setTimeout(() => {
      setState("blink");
      restoreStateTimer.current = window.setTimeout(() => {
        setState(restingState);
      }, 180);
    }, 3000 + Math.random() * 2000);

    return () => window.clearTimeout(blinkTimer);
  }, [state]);

  useEffect(
    () => () => {
      if (restoreStateTimer.current !== undefined) {
        window.clearTimeout(restoreStateTimer.current);
      }
    },
    [],
  );

  // 视线跟随只更新 CSS 变量，避免鼠标移动时持续触发 React 重渲染。
  useEffect(() => {
    let animationFrame: number | undefined;
    let pointerX = 0;
    let pointerY = 0;

    const updateEyePosition = () => {
      animationFrame = undefined;
      const pet = petElement.current;
      if (!pet) return;

      const bounds = pet.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height * 0.34;
      const directionX = Math.max(
        -1,
        Math.min(1, (pointerX - centerX) / EYE_TRACKING_CONFIG.fullRangeX),
      );
      const directionY = Math.max(
        -1,
        Math.min(1, (pointerY - centerY) / EYE_TRACKING_CONFIG.fullRangeY),
      );

      pet.style.setProperty(
        "--eye-x",
        `${(directionX * EYE_TRACKING_CONFIG.maxOffsetX).toFixed(2)}px`,
      );
      pet.style.setProperty(
        "--eye-y",
        `${(directionY * EYE_TRACKING_CONFIG.maxOffsetY).toFixed(2)}px`,
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (animationFrame === undefined) {
        animationFrame = window.requestAnimationFrame(updateEyePosition);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [
    EYE_TRACKING_CONFIG.maxOffsetX,
    EYE_TRACKING_CONFIG.maxOffsetY,
    EYE_TRACKING_CONFIG.fullRangeX,
    EYE_TRACKING_CONFIG.fullRangeY,
  ]);

  // 当前仍是 WebView 内部拖拽；原生窗口拖拽将在窗口交互任务中实现。
  const handleMouseDown = (event: React.MouseEvent) => {
    setAction("none");
    setIsDragging(true);
    setState("drag");
    hasDragged.current = false;
    dragStart.current = { x: event.clientX, y: event.clientY };
    setOffset({
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (event: MouseEvent) => {
      if (
        Math.hypot(
          event.clientX - dragStart.current.x,
          event.clientY - dragStart.current.y,
        ) > 4
      ) {
        hasDragged.current = true;
      }
      setPosition({
        x: event.clientX - offset.x,
        y: event.clientY - offset.y,
      });
    };
    const handleUp = () => {
      setIsDragging(false);
      setState("idle");
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging, offset]);

  const triggerWave = () => {
    if (hasDragged.current) return;
    setAction("wave");
  };

  const handleClick = () => {
    if (hasDragged.current) {
      hasDragged.current = false;
      return;
    }
    triggerWave();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    triggerWave();
  };

  const handleAnimationEnd = (event: React.AnimationEvent) => {
    if (event.animationName === "pet-wave") {
      setAction("none");
    }
  };

  return (
    <div
      ref={petElement}
      aria-label="让小洛宝招手"
      className={`pet-shell${state === "sleep" ? " is-sleeping" : ""}`}
      data-action={action}
      onAnimationEnd={handleAnimationEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      role="button"
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      tabIndex={0}
    >
      <TianyiArtwork action={action} expression={getExpression(state)} />
    </div>
  );
};

export default TianyiPet;
