import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { BehaviorScheduler } from "../domain/scheduler/scheduler";
import { PetActionExecutor } from "../domain/controllers/executor";
import { SvgCharacterRenderer } from "../controllers/SvgCharacterRenderer";
import { TauriWindowController } from "../controllers/TauriWindowController";
import { TauriTimerController } from "../controllers/TauriTimerController";
import { WebSpeechController } from "../controllers/WebSpeechController";
import type { RendererCapabilities } from "../domain/capabilities/capabilities";
import type { PetExpression } from "../components/TianyiArtwork";
import { ObservationHost } from "../domain/observations/host";
import { OBSERVATION_LIMITS } from "../config/observation";
import { resolveCompanionCueMotion } from "../domain/companion/catalog";

export interface PetRuntime {
  scheduler: BehaviorScheduler;
  executor: PetActionExecutor;
  renderer: SvgCharacterRenderer;
  windowController: TauriWindowController;
  timerController: TauriTimerController;
  speechController: WebSpeechController;
  observationHost: ObservationHost;
  capabilities: RendererCapabilities;
}

export interface PetRuntimeBinding {
  setExpression: (expression: PetExpression) => void;
  setMotionExpression: (expression: PetExpression | null) => void;
  setSuppressedChannels: (channels: ReadonlySet<string>) => void;
  petElement: React.RefObject<HTMLDivElement | null>;
}

const PetRuntimeContext = createContext<PetRuntime | null>(null);

export function PetRuntimeProvider({
  binding,
  children,
}: {
  binding: PetRuntimeBinding;
  children: ReactNode;
}) {
  const [capabilities, setCapabilities] = useState<RendererCapabilities>({
    motions: [],
    expressions: ["normal", "blink", "speak", "sleep"],
    lookDirection: true,
    outfits: [],
    mediaReaction: true,
  });
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const runtimeRef = useRef<PetRuntime | null>(null);

  if (!runtimeRef.current) {
    const renderer = new SvgCharacterRenderer({
      element: binding.petElement,
      onExpressionChange: binding.setExpression,
      onMotionExpressionChange: binding.setMotionExpression,
      onSuppressionChange: binding.setSuppressedChannels,
      onCapabilitiesChange: setCapabilities,
    });
    const windowController = new TauriWindowController();
    const timerController = new TauriTimerController();
    const speechController = new WebSpeechController();
    const executor = new PetActionExecutor({
      renderer,
      windowController,
      timerController,
      speechController,
    });
    const scheduler = new BehaviorScheduler({ executor });
    const observationHost = new ObservationHost({
      scheduler,
      limits: OBSERVATION_LIMITS,
      getCapabilities: () => ({
        renderer: capabilitiesRef.current,
        window: true,
        timer: true,
        speech: false,
      }),
    });
    runtimeRef.current = {
      scheduler,
      executor,
      renderer,
      windowController,
      timerController,
      speechController,
      observationHost,
      capabilities,
    };
  }

  const runtime = runtimeRef.current;

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void runtime.timerController.onFinished((timer) => {
      const motion = resolveCompanionCueMotion(
        "task.complete",
        capabilitiesRef.current.motions,
      );
      if (!motion) return;
      runtime.scheduler.submit(
        {
          id: `timer-reminder-${timer.timerId}-${timer.updatedAtUnixMs}`,
          type: "motion.play",
          payload: { motion, speed: 1 },
          source: "timer",
          requestedAt: Date.now(),
          correlationId: timer.timerId,
        },
        { channel: "body-motion", priority: "timer" },
      );
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup;
      else cleanup();
    }).catch((error: unknown) => {
      console.error("监听番茄钟完成事件失败：", error);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [runtime]);

  const contextValue: PetRuntime = { ...runtime, capabilities };

  return (
    <PetRuntimeContext.Provider value={contextValue}>
      {children}
    </PetRuntimeContext.Provider>
  );
}

export function usePetRuntime(): PetRuntime {
  const runtime = useContext(PetRuntimeContext);
  if (!runtime) {
    throw new Error("usePetRuntime 必须在 PetRuntimeProvider 内部使用");
  }
  return runtime;
}
