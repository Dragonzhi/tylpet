import type { KeyframeRef } from "../editor/model/types";

export function keyframeRefKey(ref: KeyframeRef): string {
  return `${ref.clipId}\0${ref.partId}\0${ref.frame}`;
}
