import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import TianyiArtwork, {
  type PetAction,
  type PetExpression,
} from "./TianyiArtwork";
import {
  useEarTwitch,
  useHairMotion,
  usePointerFollow,
} from "../hooks/usePetMotion";
import { useClickThrough } from "../hooks/useClickThrough";
import { useWindowDrag } from "../hooks/useWindowDrag";
import { PET_INTERACTION_CONFIG } from "../config/petInteraction";
import {
  distanceBetweenPoints,
  exceedsDragThreshold,
} from "../motion/petInteractionMath";

// 天依的核心动画状态
type PetState = "idle" | "blink" | "listen" | "speak" | "sleep" | "drag";

interface ContextMenuPosition {
  x: number;
  y: number;
}

const getExpression = (state: PetState): PetExpression => {
  if (state === "blink") return "blink";
  if (state === "speak") return "speak";
  if (state === "sleep") return "sleep";
  return "normal";
};

const TianyiPet = () => {
  const [state, setState] = useState<PetState>("idle");
  const [action, setAction] = useState<PetAction>("none");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const petElement = useRef<HTMLDivElement>(null);
  const contextMenuOpenRef = useRef(false);
  const hasDragged = useRef(false);
  const restoreStateTimer = useRef<number | undefined>(undefined);
  usePointerFollow(petElement, "global");
  useEarTwitch(petElement);
  const { beginDrag: beginHairDrag, endDrag: endHairDrag } =
    useHairMotion(petElement);
  const handleWindowDragEnd = useCallback(
    (didDrag: boolean) => {
      hasDragged.current = didDrag;
      endHairDrag();
      setState("idle");
    },
    [endHairDrag],
  );
  const windowDrag = useWindowDrag({ onEnd: handleWindowDragEnd });
  useClickThrough(petElement, {
    forceInteractive:
      state === "drag" || windowDrag.isDragging || contextMenuOpen,
  });

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
    beginHairDrag(event.screenX, event.screenY);
    if (windowDrag.beginDrag(event.screenX, event.screenY)) return;

    // 初始化尚未完成时保留系统拖动作为降级路径。
    let fallbackDidDrag = false;
    try {
      const [cursor, factor] = await Promise.all([
        cursorPosition(),
        getCurrentWindow().scaleFactor(),
      ]);
      const fallbackStart = { x: cursor.x, y: cursor.y };
      await invoke("start_dragging");
      const endCursor = await cursorPosition();
      fallbackDidDrag = exceedsDragThreshold(
        distanceBetweenPoints(fallbackStart, endCursor),
        PET_INTERACTION_CONFIG.windowDrag.dragThresholdCssPx,
        factor,
      );
    } catch (err) {
      console.error("拖拽失败:", err);
    } finally {
      hasDragged.current = fallbackDidDrag;
      endHairDrag();
      setState("idle");
    }
  };

  const showContextMenu = useCallback(
    async (position: ContextMenuPosition) => {
      if (contextMenuOpenRef.current) return;
      contextMenuOpenRef.current = true;
      setContextMenuOpen(true);

      try {
        await invoke("show_context_menu", { position });
      } catch (error) {
        console.error("打开右键菜单失败:", error);
      } finally {
        contextMenuOpenRef.current = false;
        setContextMenuOpen(false);
      }
    },
    [],
  );

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void showContextMenu({ x: event.clientX, y: event.clientY });
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
    const opensContextMenu =
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10");
    if (opensContextMenu) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = petElement.current?.getBoundingClientRect();
      if (bounds) {
        void showContextMenu({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        });
      }
      return;
    }

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
      aria-label="小洛宝，按回车招手，按菜单键打开菜单"
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
      }}
      tabIndex={0}
    >
      <TianyiArtwork action={action} expression={getExpression(state)} />
    </div>
  );
};

export default TianyiPet;
