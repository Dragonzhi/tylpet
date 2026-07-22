import type { MotionEditorProjectSnapshot } from "../project/manifest";

export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function projectDocumentText(snapshot: MotionEditorProjectSnapshot): string {
  return `${JSON.stringify(snapshot.rig, null, 2)}\n${JSON.stringify(snapshot.motions, null, 2)}\n`;
}
