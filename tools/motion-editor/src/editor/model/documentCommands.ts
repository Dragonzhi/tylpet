import {
  validateMotionLibrary,
  validateRig,
} from "@ltypet/character-motion";
import type {
  MotionClipV1,
  MotionKeyframeV1,
  PartTrackV1,
} from "@ltypet/character-motion";
import type {
  EditorCommand,
  EditorCommandResult,
  EditorDocument,
  KeyframeRef,
} from "./types";

function fail(error: string): EditorCommandResult {
  return { ok: false, error };
}

function cloneKeyframe(keyframe: MotionKeyframeV1): MotionKeyframeV1 {
  return {
    frame: keyframe.frame,
    values: { ...keyframe.values },
    ...(keyframe.easing === undefined
      ? {}
      : {
          easing: typeof keyframe.easing === "string"
            ? keyframe.easing
            : { cubicBezier: [...keyframe.easing.cubicBezier] },
        }),
  };
}

function cloneTrack(track: PartTrackV1): PartTrackV1 {
  return { partId: track.partId, keyframes: track.keyframes.map(cloneKeyframe) };
}

function cloneClip(clip: MotionClipV1): MotionClipV1 {
  return {
    ...clip,
    tracks: clip.tracks.map(cloneTrack),
    events: clip.events.map((event) => ({
      ...event,
      ...(event.payload ? { payload: { ...event.payload } } : {}),
    })),
    ...(clip.suppressProceduralChannels
      ? { suppressProceduralChannels: [...clip.suppressProceduralChannels] }
      : {}),
  };
}

function replaceClip(document: EditorDocument, clip: MotionClipV1): EditorDocument {
  return {
    ...document,
    motions: {
      ...document.motions,
      clips: document.motions.clips.map((candidate) => candidate.id === clip.id ? clip : candidate),
    },
  };
}

function validateDocument(document: EditorDocument): EditorCommandResult {
  const rig = validateRig(document.rig);
  if (!rig.ok) return fail(rig.issues.map((issue) => issue.message).join("；"));
  const motions = validateMotionLibrary(document.motions, document.rig);
  if (!motions.ok) return fail(motions.issues.map((issue) => issue.message).join("；"));
  return { ok: true, document };
}

function findClip(document: EditorDocument, clipId: string): MotionClipV1 | null {
  return document.motions.clips.find((clip) => clip.id === clipId) ?? null;
}

function upsertKeyframe(
  clip: MotionClipV1,
  partId: string,
  incoming: MotionKeyframeV1,
  merge: boolean,
): MotionClipV1 {
  const next = cloneClip(clip);
  let track = next.tracks.find((candidate) => candidate.partId === partId);
  if (!track) {
    track = { partId, keyframes: [] };
    next.tracks.push(track);
  }
  const index = track.keyframes.findIndex((keyframe) => keyframe.frame === incoming.frame);
  if (index < 0) {
    track.keyframes.push(cloneKeyframe(incoming));
  } else if (merge) {
    const current = track.keyframes[index];
    track.keyframes[index] = {
      frame: current.frame,
      values: { ...current.values, ...incoming.values },
      ...(incoming.easing !== undefined
        ? { easing: incoming.easing }
        : current.easing !== undefined ? { easing: current.easing } : {}),
    };
  } else {
    track.keyframes[index] = cloneKeyframe(incoming);
  }
  track.keyframes.sort((left, right) => left.frame - right.frame);
  return next;
}

function refsByTrack(refs: KeyframeRef[]): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const ref of refs) {
    const key = `${ref.clipId}\0${ref.partId}`;
    const frames = result.get(key) ?? new Set<number>();
    frames.add(ref.frame);
    result.set(key, frames);
  }
  return result;
}

function deleteMany(document: EditorDocument, refs: KeyframeRef[]): EditorDocument {
  const grouped = refsByTrack(refs);
  return {
    ...document,
    motions: {
      ...document.motions,
      clips: document.motions.clips.map((clip) => ({
        ...clip,
        tracks: clip.tracks.flatMap((track) => {
          const frames = grouped.get(`${clip.id}\0${track.partId}`);
          if (!frames) return [track];
          const keyframes = track.keyframes.filter((keyframe) => !frames.has(keyframe.frame));
          return keyframes.length > 0 ? [{ ...track, keyframes }] : [];
        }),
      })),
    },
  };
}

function moveMany(
  document: EditorDocument,
  refs: KeyframeRef[],
  deltaFrames: number,
): EditorCommandResult {
  if (!Number.isInteger(deltaFrames) || deltaFrames === 0) return fail("关键帧位移必须是非零整数");
  const grouped = refsByTrack(refs);
  const moved = new Map<string, MotionKeyframeV1[]>();

  for (const [key, frames] of grouped) {
    const [clipId, partId] = key.split("\0");
    const clip = findClip(document, clipId);
    const track = clip?.tracks.find((candidate) => candidate.partId === partId);
    if (!clip || !track) return fail(`找不到关键帧轨道 ${clipId}/${partId}`);
    const selected = track.keyframes.filter((keyframe) => frames.has(keyframe.frame));
    if (selected.length !== frames.size) return fail(`选择包含不存在的关键帧 ${clipId}/${partId}`);
    const occupied = new Set(track.keyframes.filter((keyframe) => !frames.has(keyframe.frame)).map((keyframe) => keyframe.frame));
    const targets = new Set<number>();
    const next = selected.map((keyframe) => {
      const frame = keyframe.frame + deltaFrames;
      if (frame < 0 || frame > clip.durationFrames) throw new Error("关键帧移动超出 Clip 范围");
      if (occupied.has(frame) || targets.has(frame)) throw new Error(`目标帧 ${frame} 已有关键帧`);
      targets.add(frame);
      return { ...cloneKeyframe(keyframe), frame };
    });
    moved.set(key, next);
  }

  let nextDocument = deleteMany(document, refs);
  try {
    for (const [key, keyframes] of moved) {
      const [clipId, partId] = key.split("\0");
      for (const keyframe of keyframes) {
        const clip = findClip(nextDocument, clipId);
        if (!clip) return fail(`找不到 Clip ${clipId}`);
        nextDocument = replaceClip(nextDocument, upsertKeyframe(clip, partId, keyframe, false));
      }
    }
  } catch (error: unknown) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  return validateDocument(nextDocument);
}

export function applyEditorCommand(
  document: EditorDocument,
  command: EditorCommand,
): EditorCommandResult {
  try {
    switch (command.type) {
      case "clip.add": {
        if (findClip(document, command.clip.id)) return fail(`Clip ID 已存在：${command.clip.id}`);
        return validateDocument({
          ...document,
          motions: { ...document.motions, clips: [...document.motions.clips, cloneClip(command.clip)] },
        });
      }
      case "clip.updateMeta": {
        const clip = findClip(document, command.clipId);
        if (!clip) return fail(`找不到 Clip：${command.clipId}`);
        const nextId = command.patch.id ?? clip.id;
        if (nextId !== clip.id && findClip(document, nextId)) return fail(`Clip ID 已存在：${nextId}`);
        const nextClip: MotionClipV1 = {
          ...cloneClip(clip),
          ...command.patch,
          id: nextId,
        };
        const nextDocument: EditorDocument = {
          ...document,
          motions: {
            ...document.motions,
            clips: document.motions.clips.map((candidate) => candidate.id === clip.id ? nextClip : candidate),
          },
        };
        return validateDocument(nextDocument);
      }
      case "clip.delete": {
        if (!findClip(document, command.clipId)) return fail(`找不到 Clip：${command.clipId}`);
        return validateDocument({
          ...document,
          motions: {
            ...document.motions,
            clips: document.motions.clips.filter((clip) => clip.id !== command.clipId),
          },
        });
      }
      case "keyframe.upsert": {
        const clip = findClip(document, command.clipId);
        if (!clip) return fail(`找不到 Clip：${command.clipId}`);
        return validateDocument(replaceClip(
          document,
          upsertKeyframe(clip, command.partId, command.keyframe, command.merge ?? true),
        ));
      }
      case "keyframe.removeValues": {
        const clip = findClip(document, command.clipId);
        const track = clip?.tracks.find((candidate) => candidate.partId === command.partId);
        const keyframe = track?.keyframes.find((candidate) => candidate.frame === command.frame);
        if (!clip || !keyframe) return fail(`找不到关键帧 ${command.partId}/${command.frame}`);
        const values = { ...keyframe.values };
        for (const property of command.properties) delete values[property];
        if (Object.keys(values).length === 0) return fail("关键帧至少需要保留一个属性");
        return validateDocument(replaceClip(document, upsertKeyframe(clip, command.partId, {
          ...keyframe,
          values,
        }, false)));
      }
      case "keyframe.deleteMany":
        return validateDocument(deleteMany(document, command.refs));
      case "keyframe.moveMany":
        return moveMany(document, command.refs, command.deltaFrames);
      case "keyframe.paste": {
        let next = document;
        const clip = findClip(document, command.clipId);
        if (!clip) return fail(`找不到 Clip：${command.clipId}`);
        const targets = new Set<string>();
        for (const entry of command.clipboard.entries) {
          const frame = command.targetFrame + entry.frameOffset;
          if (frame < 0 || frame > clip.durationFrames) return fail("粘贴关键帧超出 Clip 范围");
          const key = `${entry.partId}\0${frame}`;
          if (targets.has(key)) return fail(`剪贴板在 ${entry.partId}/${frame} 包含重复关键帧`);
          targets.add(key);
          const existing = clip.tracks.find((track) => track.partId === entry.partId)
            ?.keyframes.some((keyframe) => keyframe.frame === frame);
          if (existing) return fail(`目标 ${entry.partId}/${frame} 已有关键帧`);
        }
        for (const entry of command.clipboard.entries) {
          const currentClip = findClip(next, command.clipId)!;
          next = replaceClip(next, upsertKeyframe(currentClip, entry.partId, {
            ...entry.keyframe,
            frame: command.targetFrame + entry.frameOffset,
          }, false));
        }
        return validateDocument(next);
      }
      case "rig.updatePivot": {
        if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return fail("pivot 必须是有限数值");
        if (!document.rig.parts.some((part) => part.id === command.partId)) return fail(`找不到 Part：${command.partId}`);
        return validateDocument({
          ...document,
          rig: {
            ...document.rig,
            parts: document.rig.parts.map((part) => part.id === command.partId
              ? { ...part, pivot: { x: command.x, y: command.y, space: "partLocal" } }
              : part),
          },
        });
      }
    }
  } catch (error: unknown) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export function createKeyframeClipboard(
  document: EditorDocument,
  refs: KeyframeRef[],
): { ok: true; value: import("./types").KeyframeClipboard } | { ok: false; error: string } {
  if (refs.length === 0) return { ok: false, error: "没有选中的关键帧" };
  const clipId = refs[0].clipId;
  if (refs.some((ref) => ref.clipId !== clipId)) return { ok: false, error: "不能跨 Clip 复制" };
  const clip = findClip(document, clipId);
  if (!clip) return { ok: false, error: `找不到 Clip：${clipId}` };
  const firstFrame = Math.min(...refs.map((ref) => ref.frame));
  const entries = refs.map((ref) => {
    const keyframe = clip.tracks.find((track) => track.partId === ref.partId)
      ?.keyframes.find((candidate) => candidate.frame === ref.frame);
    if (!keyframe) throw new Error(`找不到关键帧 ${ref.partId}/${ref.frame}`);
    return { partId: ref.partId, frameOffset: ref.frame - firstFrame, keyframe: cloneKeyframe(keyframe) };
  });
  return { ok: true, value: { sourceClipId: clipId, entries } };
}
