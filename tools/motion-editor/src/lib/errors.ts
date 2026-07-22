import { MotionEditorHostRequestError } from "../host/TauriMotionEditorHost";

export function formatError(error: unknown): string {
  if (error instanceof MotionEditorHostRequestError) {
    return `${error.message}（${error.stage}/${error.code}${error.path ? `：${error.path}` : ""}）`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "未知结构化错误";
    }
  }
  return String(error);
}
