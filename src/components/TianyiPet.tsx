import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  PetRuntimeProvider,
  usePetRuntime,
} from "../hooks/usePetRuntime";
import { useSettings } from "../hooks/useSettings";
import { PET_INTERACTION_CONFIG } from "../config/petInteraction";
import {
  distanceBetweenPoints,
  exceedsDragThreshold,
} from "../motion/petInteractionMath";
import { getDefaultChannel } from "../domain/scheduler/channelPolicy";
import type { ActionRequest } from "../domain/actions/types";

// 天依的核心动画状态
type PetState = "idle" | "blink" | "listen" | "speak" | "sleep" | "drag";

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface TianyiPetInnerProps {
  action: PetAction;
  expression: PetExpression;
  setAction: (action: PetAction) => void;
  setExpression: (expression: PetExpression) => void;
  children?: ReactNode;
}

const TianyiPetInner = ({
  action,
  expression,
  setAction,
  setExpression,
  children,
}: TianyiPetInnerProps) => {
  const petElement = useRef<HTMLDivElement>(null);

  return (
    <PetRuntimeProvider
      binding={{ petElement, setAction, setExpression }}
    >
      <TianyiPetInnerContent
        action={action}
        expression={expression}
        setAction={setAction}
        setExpression={setExpression}
        petElement={petElement}
      />
      {children}
    </PetRuntimeProvider>
  );
};

interface TianyiPetInnerContentProps {
  action: PetAction;
  expression: PetExpression;
  setAction: (action: PetAction) => void;
  setExpression: (expression: PetExpression) => void;
  petElement: React.RefObject<HTMLDivElement | null>;
}

const TianyiPetInnerContent = ({
  action,
  expression,
  setAction,
  setExpression,
  petElement,
}: TianyiPetInnerContentProps) => {
  const [state, setState] = useState<PetState>("idle");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const contextMenuOpenRef = useRef(false);
  const hasDragged = useRef(false);
  const restoreStateTimer = useRef<number | undefined>(undefined);

  const { scheduler } = usePetRuntime();
  const { updateWindowPosition } = useSettings();

  // Keep hooks as-is
  usePointerFollow(petElement, "global");
  useEarTwitch(petElement);
  const { beginDrag: beginHairDrag, endDrag: endHairDrag } =
    useHairMotion(petElement);

  // --- Drag end handler: resume agent actions and persist window position ---
  const handleWindowDragEnd = useCallback(
    (didDrag: boolean) => {
      hasDragged.current = didDrag;
      endHairDrag();
      setState("idle");
      scheduler.resumeAgentActions();

      // Persist window position after drag
      if (didDrag) {
        void (async () => {
          try {
            const pos = await getCurrentWindow().outerPosition();
            updateWindowPosition(pos.x, pos.y);
          } catch {
            // 位置获取失败不影响交互
          }
        })();
      }
    },
    [endHairDrag, scheduler, updateWindowPosition],
  );
  const windowDrag = useWindowDrag({ onEnd: handleWindowDragEnd });
  useClickThrough(petElement, {
    forceInteractive:
      state === "drag" || windowDrag.isDragging || contextMenuOpen,
  });

  // idle 动画循环 — 随机眨眼，并在短暂动作结束后恢复原状态。
  useEffect(() => {
    if (state !== "idle" && state !== "listen") return;

    const blinkTimer = window.setTimeout(() => {
      setExpression("blink");
      restoreStateTimer.current = window.setTimeout(() => {
        setExpression("normal");
      }, 180);
    }, 3000 + Math.random() * 2000);

    return () => window.clearTimeout(blinkTimer);
  }, [state, setExpression]);

  useEffect(
    () => () => {
      if (restoreStateTimer.current !== undefined) {
        window.clearTimeout(restoreStateTimer.current);
      }
    },
    [],
  );

  // --- Cleanup on unmount: cancel all, don't dispose (StrictMode safe) ---
  useEffect(() => {
    return () => {
      scheduler.cancelAll();
    };
  }, [scheduler]);

  const handleMouseDown = async (event: React.MouseEvent) => {
    if (event.button !== 0) return;

    scheduler.cancelChannel("locomotion");
    scheduler.pauseAgentActions();

    setAction("none");
    setState("drag");
    hasDragged.current = false;
    beginHairDrag(event.screenX, event.screenY);
    if (windowDrag.beginDrag(event.screenX, event.screenY)) return;

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
      scheduler.resumeAgentActions();
    }
  };

  const showContextMenu = useCallback(
    async (position: ContextMenuPosition) => {
      if (contextMenuOpenRef.current) return;
      contextMenuOpenRef.current = true;
      setContextMenuOpen(true);
      scheduler.pauseAgentActions();

      try {
        await invoke("show_context_menu", { position });
      } catch (error) {
        console.error("打开右键菜单失败:", error);
      } finally {
        contextMenuOpenRef.current = false;
        setContextMenuOpen(false);
        scheduler.resumeAgentActions();
      }
    },
    [scheduler],
  );

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void showContextMenu({ x: event.clientX, y: event.clientY });
  };

  const triggerWave = useCallback(() => {
    if (hasDragged.current) return;
    const channel = getDefaultChannel("motion.play");
    if (!channel) return;
    const actionRequest: ActionRequest = {
      id: `wave-${Date.now()}`,
      type: "motion.play",
      payload: { motion: "wave" },
      source: "user",
      requestedAt: Date.now(),
    } as ActionRequest;
    scheduler.submit(actionRequest, { channel, priority: "user" });
  }, [scheduler]);

  const handleClick = useCallback(() => {
    if (hasDragged.current) {
      hasDragged.current = false;
      return;
    }
    triggerWave();
  }, [triggerWave]);

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

  return (
    <div
      ref={petElement}
      aria-label="小洛宝，按回车招手，按菜单键打开菜单"
      className={`pet-shell${state === "sleep" ? " is-sleeping" : ""}`}
      data-action={action}
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
      <TianyiArtwork action={action} expression={expression} />
    </div>
  );
};

interface TianyiPetProps {
  children?: ReactNode;
}

const TianyiPet = ({ children }: TianyiPetProps) => {
  const [action, setAction] = useState<PetAction>("none");
  const [expression, setExpression] = useState<PetExpression>("normal");

  return (
    <TianyiPetInner
      action={action}
      expression={expression}
      setAction={setAction}
      setExpression={setExpression}
    >
      {children}
    </TianyiPetInner>
  );
};

export default TianyiPet;
