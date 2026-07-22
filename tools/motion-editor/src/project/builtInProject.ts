import type { MotionEditorProjectManifestV1 } from "./manifest";

export const BUILT_IN_ARTWORK_NAME = "artwork.svg";

export const BUILT_IN_MANIFEST: MotionEditorProjectManifestV1 = {
  schemaVersion: 1,
  projectId: "xiaoluobao",
  displayName: "小洛宝",
  characterRigId: "xiaoluobao",
  files: {
    artwork: BUILT_IN_ARTWORK_NAME,
    rig: "rig.v1.json",
    motions: "motions.v1.json",
    editor: "editor.json",
  },
};
