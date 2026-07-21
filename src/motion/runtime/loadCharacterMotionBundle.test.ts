import { describe, expect, it } from "vitest";
import { sampleMotionClip } from "@ltypet/character-motion";
import artworkText from "../../assets/character/xiaoluobao/artwork.svg?raw";
import rigJson from "../../assets/character/xiaoluobao/rig.v1.json";
import motionsJson from "../../assets/character/xiaoluobao/motions.v1.json";
import {
  loadCharacterMotionBundle,
} from "./loadCharacterMotionBundle";

const clone = <T>(value: T): T => structuredClone(value);

describe("生产动作资产加载", () => {
  it("严格校验正式 artwork、rig 和 motions", async () => {
    const bundle = await loadCharacterMotionBundle({
      artworkText,
      artworkSource: "artwork.svg",
      rigJson,
      motionsJson,
    });
    expect(bundle.rig.parts).toHaveLength(33);
    expect([...bundle.clips.keys()]).toEqual(["bow", "stretch", "wave"]);
    expect([...bundle.clips.values()].map((clip) => clip.loop)).toEqual([
      "none",
      "none",
      "none",
    ]);
  });

  it("三个生产动作均可合法采样并自然回到 bind pose", async () => {
    const bundle = await loadCharacterMotionBundle({
      artworkText,
      artworkSource: "artwork.svg",
      rigJson,
      motionsJson,
    });
    const validSlots = new Set(bundle.rig.renderSlots);

    for (const clip of bundle.clips.values()) {
      for (let frame = 0; frame <= clip.durationFrames; frame += 1) {
        const sample = sampleMotionClip(clip, frame, bundle.rig);
        for (const transform of sample.transforms.values()) {
          expect(Object.values(transform).every(Number.isFinite)).toBe(true);
        }
        for (const slot of sample.renderSlots.values()) {
          expect(validSlots.has(slot)).toBe(true);
        }
      }

      for (const frame of [0, clip.durationFrames]) {
        const sample = sampleMotionClip(clip, frame, bundle.rig);
        for (const transform of sample.transforms.values()) {
          expect(transform).toEqual({
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          });
        }
      }
    }

    expect(bundle.clips.get("bow")?.tracks.map((track) => track.partId)).toEqual([
      "arm_left",
      "arm_right",
      "body",
      "head",
    ]);
    expect(bundle.clips.get("stretch")?.suppressProceduralChannels).toEqual([
      "breathing",
      "pointer-follow",
    ]);
    for (const partId of ["arm_left", "arm_right"]) {
      const stretch = bundle.clips.get("stretch");
      if (!stretch) throw new Error("stretch fixture must exist");
      expect(sampleMotionClip(stretch, 0, bundle.rig).renderSlots.get(partId)).toBe("body");
      expect(sampleMotionClip(stretch, 20, bundle.rig).renderSlots.get(partId)).toBe("front");
      expect(sampleMotionClip(stretch, 52, bundle.rig).renderSlots.get(partId)).toBe("body");
    }
  });

  it("素材内容损坏时拒绝指纹", async () => {
    await expect(loadCharacterMotionBundle({
      artworkText: artworkText.replace("</svg>", "<g /></svg>"),
      artworkSource: "artwork.svg",
      rigJson,
      motionsJson,
    })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "artwork-fingerprint-mismatch" }),
      ]),
    });
  });

  it("未知 Part binding 会给出明确诊断", async () => {
    const badRig = clone(rigJson);
    badRig.parts[0].sourceBinding.value = "missing_part";
    await expect(loadCharacterMotionBundle({
      artworkText,
      artworkSource: "artwork.svg",
      rigJson: badRig,
      motionsJson,
    })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "missing-source-binding" }),
      ]),
    });
  });

  it("缺少 wave 时拒绝进入生产能力列表", async () => {
    const badMotions = clone(motionsJson);
    const wave = badMotions.clips.find((clip) => clip.id === "wave");
    if (!wave) throw new Error("wave fixture must exist");
    wave.id = "other";
    await expect(loadCharacterMotionBundle({
      artworkText,
      artworkSource: "artwork.svg",
      rigJson,
      motionsJson: badMotions,
    })).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "missing-wave" }),
      ]),
    });
  });
});
