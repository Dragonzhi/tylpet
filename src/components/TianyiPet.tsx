import { useEffect, useRef, useState } from "react";
import TianyiArtwork, { type PetExpression } from "./TianyiArtwork";

// 天依的核心动画状态
type PetState = "idle" | "blink" | "listen" | "speak" | "sleep" | "drag";

const getExpression = (state: PetState): PetExpression => {
  if (state === "blink") return "blink";
  if (state === "speak") return "speak";
  if (state === "sleep") return "sleep";
  return "normal";
};

const TianyiPet = () => {
  const [state, setState] = useState<PetState>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
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

  // 当前仍是 WebView 内部拖拽；原生窗口拖拽将在窗口交互任务中实现。
  const handleMouseDown = (event: React.MouseEvent) => {
    setIsDragging(true);
    setState("drag");
    setOffset({
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    });
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (event: MouseEvent) => {
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

  return (
    <div
      className={`pet-shell${state === "sleep" ? " is-sleeping" : ""}`}
      onMouseDown={handleMouseDown}
      style={{
        left: position.x,
        top: position.y,
        cursor: isDragging ? "grabbing" : "grab",
      }}
    >
      <TianyiArtwork expression={getExpression(state)} />
    </div>
  );
};

export default TianyiPet;
