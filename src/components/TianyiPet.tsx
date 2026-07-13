import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import TianyiArtwork, {
  type PetAction,
  type PetExpression,
} from "./TianyiArtwork";
import { useEarTwitch, usePointerFollow } from "../hooks/usePetMotion";

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
  const [action, setAction] = useState<PetAction>("none");
  const petElement = useRef<HTMLDivElement>(null);
  const hasDragged = useRef(false);
  const restoreStateTimer = useRef<number | undefined>(undefined);
  usePointerFollow(petElement, "global");
  useEarTwitch(petElement);

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

  const handleMouseDown = async (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    setAction("none");
    setState("drag");
    hasDragged.current = false;
    try {
      await invoke("start_dragging");
    } catch (err) {
      console.error("拖拽失败:", err);
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    // Context menu is handled by Tauri native menu at cursor position
  };

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
      onContextMenu={handleContextMenu}
      role="button"
      style={{
        cursor: state === "drag" ? "grabbing" : "grab",
        // -webkit-app-region: drag 让整个 WebView 区域可拖动；
        // 交互元素需通过 -webkit-app-region: no-drag 排除（暂无按钮，先留占位）
        ...({ "-webkit-app-region": "drag" } as React.CSSProperties),
      }}
      tabIndex={0}
    >
      <TianyiArtwork action={action} expression={getExpression(state)} />
    </div>
  );
};

export default TianyiPet;
