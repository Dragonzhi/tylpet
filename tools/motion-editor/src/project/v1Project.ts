import type {
  CharacterRigV1,
  MotionClipV1,
  MotionLibraryV1,
  RigPartV1,
  ValidationIssue,
} from "@ltypet/character-motion";
import { validateMotionLibrary, validateRig } from "@ltypet/character-motion";
import type { ImportResult, ImportedPartRef } from "../svgcanvas/SvgCanvasAdapter";

const BODY_PARTS = new Set([
  "arm_left",
  "arm_right",
  "leg_left",
  "leg_right",
  "body",
  "white_cloth",
  "blue_decoration",
  "black_decoration",
  "tie",
  "tie_tail",
]);

function defaultRenderSlot(partId: string): string {
  if (partId.startsWith("hair_tail_")) return "back";
  if (BODY_PARTS.has(partId)) return "body";
  return "head";
}

function buildRigPart(
  part: ImportedPartRef,
  pivotLocal: Map<string, { x: number; y: number }>,
): RigPartV1 {
  const pivot = pivotLocal.get(part.partId) ?? { x: 0, y: 0 };
  return {
    id: part.partId,
    sourceBinding: { kind: "inkscapeLabel", value: part.inkscapeLabel },
    // 当前 glax 素材是扁平绝对坐标。P1 不伪造骨骼父子关系；P2 由 rig UI 显式编辑。
    logicalParentId: null,
    defaultRenderSlot: defaultRenderSlot(part.partId),
    pivot: { x: pivot.x, y: pivot.y, space: "partLocal" },
    bindMatrix: [...part.bindMatrix],
    ...(pivotLocal.has(part.partId) ? { tags: ["has_pivot"] } : {}),
  };
}

export function buildRigFromImport(
  imported: ImportResult,
  artwork: { source: string; fingerprint: string },
): CharacterRigV1 {
  const candidate: CharacterRigV1 = {
    schemaVersion: 1,
    rigId: "xiaoluobao",
    artwork: {
      source: artwork.source,
      fingerprint: artwork.fingerprint,
      viewBox: [...imported.viewBox],
    },
    renderSlots: ["back", "body", "head", "front"],
    parts: imported.parts.map((part) => buildRigPart(part, imported.pivotLocal)),
  };

  const validation = validateRig(candidate);
  if (!validation.ok) {
    throw new Error(`生成的 rig 无效：${formatValidationIssues(validation.issues)}`);
  }
  return validation.value;
}

export function createWaveExample(rig: CharacterRigV1): MotionLibraryV1 {
  if (!rig.parts.some((part) => part.id === "arm_right")) {
    throw new Error("当前 rig 不包含 arm_right，无法载入挥手示例");
  }
  return {
    schemaVersion: 1,
    rigId: rig.rigId,
    clips: [
      {
        id: "p0-wave",
        fps: 24,
        durationFrames: 24,
        loop: "repeat",
        tracks: [
          {
            partId: "arm_right",
            keyframes: [
              { frame: 0, values: { rotation: 0 }, easing: "easeInOut" },
              { frame: 12, values: { rotation: -55 }, easing: "easeInOut" },
              { frame: 24, values: { rotation: 0 }, easing: "easeInOut" },
            ],
          },
        ],
        events: [],
      },
    ],
  };
}

export function parseMotionLibraryForRig(
  text: string,
  rig: CharacterRigV1,
): MotionLibraryV1 {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error: unknown) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const validation = validateMotionLibrary(input, rig);
  if (!validation.ok) {
    throw new Error(`动作文件校验失败：${formatValidationIssues(validation.issues)}`);
  }
  return validation.value;
}

export function parseRigForArtwork(
  text: string,
  imported: ImportResult,
  artwork: { source: string; fingerprint: string },
): CharacterRigV1 {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error: unknown) {
    throw new Error(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const validation = validateRig(input);
  if (!validation.ok) {
    throw new Error(`Rig 文件校验失败：${formatValidationIssues(validation.issues)}`);
  }
  const rig = validation.value;
  if (rig.artwork.fingerprint !== artwork.fingerprint) {
    throw new Error(`Rig 素材指纹不匹配：期望 ${artwork.fingerprint}，实际 ${rig.artwork.fingerprint}`);
  }
  if (rig.artwork.source !== artwork.source) {
    throw new Error(`Rig 素材来源不匹配：期望 ${artwork.source}，实际 ${rig.artwork.source}`);
  }
  if (rig.artwork.viewBox.some((value, index) => Math.abs(value - imported.viewBox[index]) > 1e-8)) {
    throw new Error("Rig viewBox 与当前素材不匹配");
  }
  const importedParts = new Map(imported.parts.map((part) => [part.partId, part]));
  for (const part of rig.parts) {
    const source = importedParts.get(part.id);
    if (!source) throw new Error(`Rig Part 在当前素材中不存在：${part.id}`);
    if (
      part.sourceBinding.kind === "inkscapeLabel" &&
      part.sourceBinding.value !== source.inkscapeLabel
    ) {
      throw new Error(`Rig Part ${part.id} 的 inkscape:label binding 不匹配`);
    }
    if (
      part.sourceBinding.kind === "elementId" &&
      part.sourceBinding.value !== source.sourceElementId
    ) {
      throw new Error(`Rig Part ${part.id} 的 elementId binding 不匹配`);
    }
  }
  return rig;
}

export function firstPlayableTrack(library: MotionLibraryV1): {
  clip: MotionClipV1;
  partId: string;
} | null {
  for (const clip of library.clips) {
    const track = clip.tracks[0];
    if (track) return { clip, partId: track.partId };
  }
  return null;
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join("；");
}
