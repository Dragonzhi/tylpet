import type { ActionRequest, ActionResult } from "../actions/types";
import type { ActionExecutor } from "../scheduler/types";
import type { CharacterRenderer, SpeechController, TimerController, WindowController } from "./types";

export interface PetActionExecutorOptions {
  renderer: CharacterRenderer;
  windowController: WindowController;
  timerController?: TimerController;
  speechController?: SpeechController;
  clock?: () => number;
}

export class PetActionExecutor implements ActionExecutor {
  private renderer: CharacterRenderer;
  private windowController: WindowController;
  private timerController?: TimerController;
  private speechController?: SpeechController;
  private clock: () => number;
  private disposed = false;

  constructor(options: PetActionExecutorOptions) {
    this.renderer = options.renderer;
    this.windowController = options.windowController;
    this.timerController = options.timerController;
    this.speechController = options.speechController;
    this.clock = options.clock ?? (() => Date.now());
  }

  private async withAbort<T>(
    run: () => Promise<T>,
    signal: AbortSignal,
    onAbort?: () => void,
  ): Promise<T> {
    if (signal.aborted) throw new Error("aborted");
    return new Promise<T>((resolve, reject) => {
      const onAbortHandler = () => {
        onAbort?.();
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbortHandler, { once: true });
      run().then(
        (result) => {
          signal.removeEventListener("abort", onAbortHandler);
          resolve(result);
        },
        (error) => {
          signal.removeEventListener("abort", onAbortHandler);
          reject(error);
        },
      );
    });
  }

  async execute(action: ActionRequest, signal: AbortSignal): Promise<ActionResult> {
    if (this.disposed) {
      throw new Error("PetActionExecutor is disposed");
    }

    try {
      switch (action.type) {
        case "motion.play": {
          await this.withAbort(
            () => this.renderer.playMotion(action.payload.motion, {
              speed: action.payload.speed,
              signal,
            }),
            signal,
            () => this.renderer.reset("interrupt"),
          );
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "expression.set": {
          await this.withAbort(
            () => this.renderer.setExpression(action.payload.expression, { durationMs: action.payload.durationMs }),
            signal,
            () => this.renderer.reset("interrupt"),
          );
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "look.set": {
          this.renderer.setLookDirection(action.payload.x, action.payload.y);
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "window.move": {
          await this.withAbort(
            () => this.windowController.moveTo(
              action.payload.target,
              { durationMs: action.payload.durationMs, signal },
            ),
            signal,
          );
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "outfit.equip": {
          await this.withAbort(
            () => this.renderer.equipOutfit(action.payload.outfitId),
            signal,
            () => this.renderer.reset("interrupt"),
          );
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "timer.start": {
          if (!this.timerController) return this.unavailableTimerResult(action.id);
          await this.withAbort(
            () => this.timerController!.start({
              timerId: action.id,
              durationMs: action.payload.durationMs,
              label: action.payload.label,
              kind: action.payload.kind,
            }),
            signal,
            () => {
              void this.timerController!.cancel(action.id).catch(() => undefined);
            },
          );
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "timer.pause": {
          if (!this.timerController) return this.unavailableTimerResult(action.id);
          await this.withAbort(() => this.timerController!.pause(action.payload.timerId), signal);
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "timer.resume": {
          if (!this.timerController) return this.unavailableTimerResult(action.id);
          await this.withAbort(() => this.timerController!.resume(action.payload.timerId), signal);
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "timer.cancel": {
          if (!this.timerController) return this.unavailableTimerResult(action.id);
          await this.withAbort(() => this.timerController!.cancel(action.payload.timerId), signal);
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "media.react": {
          this.renderer.setMediaReaction(action.payload.state);
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "speech.say": {
          if (!this.speechController || !this.speechController.isAvailable()) {
            return {
              actionId: action.id,
              status: "rejected",
              errorCode: "renderer_unavailable",
              reason: "系统语音合成不可用",
              finishedAt: this.clock(),
            };
          }
          const hasContinuousMouth = Boolean(this.renderer.setSpeechState && this.renderer.setMouthOpen);
          if (hasContinuousMouth) this.renderer.setSpeechState?.(true);
          else await this.renderer.setExpression("speak");
          try {
            await this.withAbort(
              () => this.speechController!.say(action.payload.text, {
                onMouthLevel: (amount) => this.renderer.setMouthOpen?.(amount),
              }),
              signal,
              () => this.speechController!.stop(),
            );
          } finally {
            this.renderer.setMouthOpen?.(0);
            if (hasContinuousMouth) this.renderer.setSpeechState?.(false);
            else await this.renderer.setExpression("normal");
          }
          return { actionId: action.id, status: "completed", finishedAt: this.clock() };
        }
        case "memory.propose":
          return { actionId: action.id, status: "rejected", errorCode: "unsupported_action", reason: "记忆候选只能在聊天确认链路中处理", finishedAt: this.clock() };
        case "wait":
          return { actionId: action.id, status: "rejected", errorCode: "unsupported_action", reason: "wait 不应到达执行器", finishedAt: this.clock() };
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "aborted") {
        return { actionId: action.id, status: "interrupted", finishedAt: this.clock() };
      }
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "unsupported_action" ||
          error.code === "renderer_unavailable" ||
          String(error.code).startsWith("timer_") ||
          String(error.code).startsWith("speech_"))
      ) {
        return {
          actionId: action.id,
          status: "rejected",
          errorCode: String(error.code),
          reason: error.message,
          finishedAt: this.clock(),
        };
      }
      return { actionId: action.id, status: "failed", finishedAt: this.clock(), reason: String(error) };
    }
  }

  dispose(): void {
    this.renderer.dispose();
    this.windowController.dispose();
    this.timerController?.dispose();
    this.speechController?.dispose();
    this.disposed = true;
  }

  private unavailableTimerResult(actionId: string): ActionResult {
    return {
      actionId,
      status: "rejected",
      errorCode: "renderer_unavailable",
      reason: "番茄钟控制器不可用",
      finishedAt: this.clock(),
    };
  }
}
