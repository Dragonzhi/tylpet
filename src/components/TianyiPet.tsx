import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import TianyiArtwork, { type PetExpression } from "./TianyiArtwork";
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
import AgentRuntimeBridge from "./AgentRuntimeBridge";
import ObservationRuntimeBridge from "./ObservationRuntimeBridge";
import { PET_ANIMATION_CONFIG } from "../config/petAnimation";
import SpeechRuntimeBridge from "./SpeechRuntimeBridge";
import { getBehaviorModePolicy } from "../domain/behavior/modePolicy";
import RuntimeDiagnosticsBridge from "./RuntimeDiagnosticsBridge";
import CompanionRuntimeBridge from "./CompanionRuntimeBridge";
import type { CompanionPetState } from "../domain/companion/types";

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface TianyiPetInnerProps {
  expression: PetExpression;
  setExpression: (expression: PetExpression) => void;
  setMotionExpression: (expression: PetExpression | null) => void;
  suppressedChannels: ReadonlySet<string>;
  setSuppressedChannels: (channels: ReadonlySet<string>) => void;
  children?: ReactNode;
}

const TianyiPetInner = ({
  expression,
  setExpression,
  setMotionExpression,
  suppressedChannels,
  setSuppressedChannels,
  children,
}: TianyiPetInnerProps) => {
  const petElement = useRef<HTMLDivElement>(null);

  return (
    <PetRuntimeProvider
      binding={{
        petElement,
        setExpression,
        setMotionExpression,
        setSuppressedChannels,
      }}
    >
      <TianyiPetInnerContent
        expression={expression}
        setExpression={setExpression}
        suppressedChannels={suppressedChannels}
        petElement={petElement}
      />
      {children}
    </PetRuntimeProvider>
  );
};

interface TianyiPetInnerContentProps {
  expression: PetExpression;
  setExpression: (expression: PetExpression) => void;
  suppressedChannels: ReadonlySet<string>;
  petElement: React.RefObject<HTMLDivElement | null>;
}

const TianyiPetInnerContent = ({
  expression,
  setExpression,
  suppressedChannels,
  petElement,
}: TianyiPetInnerContentProps) => {
  const [state, setState] = useState<CompanionPetState>("idle");
  const [lastUserInteractionAtMs, setLastUserInteractionAtMs] = useState(() => Date.now());
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const contextMenuOpenRef = useRef(false);
  const hasDragged = useRef(false);
  const restoreStateTimer = useRef<number | undefined>(undefined);
  const engagementStateRef = useRef<"idle" | "listen" | "speak">("idle");

  const { scheduler, renderer, speechController } = usePetRuntime();
  const { settings, updateWindowPosition } = useSettings();
  const modePolicy = getBehaviorModePolicy(settings?.behavior.mode ?? "companion");
  const effectiveAnimationIntensity = (settings?.animation.intensity ?? 1)
    * modePolicy.animationIntensityMultiplier;
  const musicConfig = PET_ANIMATION_CONFIG.musicReaction;
  const mouthConfig = PET_ANIMATION_CONFIG.speechMouth;
  const musicIntensity = (settings?.observation.musicReactionIntensity
    ?? musicConfig.defaultIntensity) * modePolicy.observationIntensityMultiplier;
  const petStyle: PetShellStyle = {
    cursor: state === "drag" ? "grabbing" : "grab",
    "--music-cycle-ms": `${musicConfig.cycleMs}ms`,
    "--music-transition-ms": `${musicConfig.transitionMs}ms`,
    "--music-config-bob-target": `${musicConfig.bodyBobPx * musicIntensity}px`,
    "--music-config-tilt-target": `${musicConfig.bodyTiltDeg * musicIntensity}deg`,
    "--music-config-tail-target": `${musicConfig.tailRotateDeg * musicIntensity}deg`,
    "--music-config-ear-target": `${musicConfig.earRotateDeg * musicIntensity}deg`,
    "--music-config-particle-opacity": settings?.companion.particlesEnabled === false
      ? 0
      : musicIntensity * 0.55,
    "--mouth-normal-maximum": mouthConfig.normalMaximum,
    "--mouth-scale-x-minimum": mouthConfig.scaleXMinimum,
    "--mouth-scale-x-range": 1 - mouthConfig.scaleXMinimum,
    "--mouth-scale-y-minimum": mouthConfig.scaleYMinimum,
    "--mouth-scale-y-range": 1 - mouthConfig.scaleYMinimum,
    "--mouth-open-opacity-multiplier": mouthConfig.openOpacityMultiplier,
    "--mouth-closed-fade-multiplier": mouthConfig.closedFadeMultiplier,
    "--mouth-reduced-motion-level": mouthConfig.reducedMotionLevel,
    "--mouth-transition-ms": `${mouthConfig.smoothingMs}ms`,
    "--breath-scale-y": 1 + 0.01 * effectiveAnimationIntensity,
    "--breath-cycle-ms": `${Math.round(3600 / Math.max(0.2, effectiveAnimationIntensity))}ms`,
    "--limb-cycle-ms": `${Math.round(3600 / Math.max(0.2, effectiveAnimationIntensity))}ms`,
    "--tie-cycle-ms": `${Math.round(2900 / Math.max(0.2, effectiveAnimationIntensity))}ms`,
  };

  // Keep hooks as-is
  usePointerFollow(
    petElement,
    "global",
    !modePolicy.sleeping && !suppressedChannels.has("pointer-follow"),
  );
  useEarTwitch(petElement, !modePolicy.sleeping && !suppressedChannels.has("ear-twitch"));
  const { beginDrag: beginHairDrag, endDrag: endHairDrag } =
    useHairMotion(petElement, !modePolicy.sleeping && !suppressedChannels.has("hair-physics"));

  const markUserInteraction = useCallback(() => {
    setLastUserInteractionAtMs(Date.now());
  }, []);

  const handleEngagementStateChange = useCallback((next: "idle" | "listen" | "speak") => {
    engagementStateRef.current = next;
    setState((current) => current === "drag" ? current : next);
  }, []);

  useEffect(() => {
    if (modePolicy.allowAgent) {
      scheduler.resumeAgentActions("behavior-mode");
      return;
    }
    scheduler.pauseAgentActions("behavior-mode");
    scheduler.cancelAgentActions();
    scheduler.cancelChannel("ambient");
    scheduler.cancelChannel("speech");
    renderer.setMediaReaction("stopped");
    speechController.stop();
    return () => scheduler.resumeAgentActions("behavior-mode");
  }, [modePolicy.allowAgent, renderer, scheduler, speechController]);

  // --- Drag end handler: resume agent actions and persist window position ---
  const handleWindowDragEnd = useCallback(
    (didDrag: boolean) => {
      hasDragged.current = didDrag;
      endHairDrag();
      setState(engagementStateRef.current);
      markUserInteraction();
      scheduler.resumeAgentActions("drag");

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
    [endHairDrag, markUserInteraction, scheduler, updateWindowPosition],
  );
  const windowDrag = useWindowDrag({ onEnd: handleWindowDragEnd });
  useClickThrough(petElement, {
    forceInteractive:
      state === "drag" || windowDrag.isDragging || contextMenuOpen,
  });

  // idle 动画循环 — 随机眨眼，并在短暂动作结束后恢复原状态。
  useEffect(() => {
    if (state !== "idle" && state !== "listen") return;
    if (suppressedChannels.has("blinking")) return;

    const blinkTimer = window.setTimeout(() => {
      setExpression("blink");
      restoreStateTimer.current = window.setTimeout(() => {
        setExpression("normal");
      }, 180);
    }, (3000 + Math.random() * 2000) * modePolicy.blinkIntervalMultiplier);

    return () => window.clearTimeout(blinkTimer);
  }, [modePolicy.blinkIntervalMultiplier, state, setExpression, suppressedChannels]);

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

    markUserInteraction();

    scheduler.cancelChannel("locomotion");
    scheduler.cancelChannel("body-motion");
    scheduler.pauseAgentActions("drag");

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
      setState(engagementStateRef.current);
      scheduler.resumeAgentActions("drag");
    }
  };

  const showContextMenu = useCallback(
    async (position: ContextMenuPosition) => {
      if (contextMenuOpenRef.current) return;
      markUserInteraction();
      contextMenuOpenRef.current = true;
      setContextMenuOpen(true);
      scheduler.pauseAgentActions("context-menu");

      try {
        await invoke("show_context_menu", { position });
      } catch (error) {
        console.error("打开右键菜单失败:", error);
      } finally {
        contextMenuOpenRef.current = false;
        setContextMenuOpen(false);
        scheduler.resumeAgentActions("context-menu");
      }
    },
    [markUserInteraction, scheduler],
  );

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void showContextMenu({ x: event.clientX, y: event.clientY });
  };

  const triggerWave = useCallback(() => {
    if (hasDragged.current) return;
    markUserInteraction();
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
  }, [markUserInteraction, scheduler]);

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

  const handleMotionTargetReady = useCallback(
    (target: Parameters<typeof renderer.setMotionTarget>[0]) => {
      renderer.setMotionTarget(target);
    },
    [renderer],
  );

  const visualState: CompanionPetState = modePolicy.sleeping && state !== "drag"
    ? "sleep"
    : state;

  return (
    <>
    <SpeechRuntimeBridge
      speech={settings?.speech ?? null}
      audio={settings?.audio ?? null}
      enabledByMode={modePolicy.allowSpeech}
    />
    <AgentRuntimeBridge
      enabled={Boolean(settings?.agent.enabled && modePolicy.allowAgent)}
      speechEnabled={Boolean(
        modePolicy.allowSpeech
        && settings?.speech.enabled
        && settings.audio.enabled
        && settings.audio.volume > 0
        && speechController.isAvailable(),
      )}
    />
    <ObservationRuntimeBridge
      settings={settings?.observation ?? null}
      modePolicy={modePolicy}
    />
    <CompanionRuntimeBridge
      settings={settings?.companion ?? null}
      mode={modePolicy.mode}
      petState={visualState}
      lastUserInteractionAtMs={lastUserInteractionAtMs}
      onEngagementStateChange={handleEngagementStateChange}
      onUserActivity={markUserInteraction}
    />
    <RuntimeDiagnosticsBridge behaviorMode={modePolicy.mode} />
    <div
      ref={petElement}
      aria-label="小洛宝，按回车招手，按菜单键打开菜单"
      className={`pet-shell${modePolicy.sleeping && state !== "drag" ? " is-sleeping" : ""}`}
      data-behavior-mode={modePolicy.mode}
      data-pet-state={visualState}
      data-mouth-cross-fade={mouthConfig.crossFadeEnabled ? "true" : "false"}
      data-suppress-breathing={suppressedChannels.has("breathing") || undefined}
      data-suppress-blinking={suppressedChannels.has("blinking") || undefined}
      data-suppress-pointer-follow={suppressedChannels.has("pointer-follow") || undefined}
      data-suppress-hair-physics={suppressedChannels.has("hair-physics") || undefined}
      data-suppress-ear-twitch={suppressedChannels.has("ear-twitch") || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      role="button"
      style={petStyle}
      tabIndex={0}
    >
      <TianyiArtwork
        expression={modePolicy.sleeping && state !== "drag" && expression === "normal"
          ? "sleep"
          : expression}
        onMotionTargetReady={handleMotionTargetReady}
      />
    </div>
    </>
  );
};

type PetShellStyle = CSSProperties & {
  [K in `--${string}`]?: string | number;
};

interface TianyiPetProps {
  children?: ReactNode;
}

const TianyiPet = ({ children }: TianyiPetProps) => {
  const [baseExpression, setBaseExpression] = useState<PetExpression>("normal");
  const [motionExpression, setMotionExpression] = useState<PetExpression | null>(null);
  const [suppressedChannels, setSuppressedChannels] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  return (
    <TianyiPetInner
      expression={motionExpression ?? baseExpression}
      setExpression={setBaseExpression}
      setMotionExpression={setMotionExpression}
      suppressedChannels={suppressedChannels}
      setSuppressedChannels={setSuppressedChannels}
    >
      {children}
    </TianyiPetInner>
  );
};

export default TianyiPet;
