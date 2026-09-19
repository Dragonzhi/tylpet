import type { CompanionCue } from "./types";

export interface CompanionMotionChoice {
  cue: CompanionCue;
  motion: string;
  speed: number;
  weight: number;
}

const AMBIENT_CHOICES: readonly CompanionMotionChoice[] = [
  { cue: "idle.stretch", motion: "stretch", speed: 0.9, weight: 6 },
  { cue: "idle.greet", motion: "wave", speed: 0.9, weight: 2 },
  { cue: "idle.courtesy", motion: "bow", speed: 0.85, weight: 1 },
];

const CUE_PREFERENCES: Record<CompanionCue, readonly string[]> = {
  "idle.stretch": ["stretch", "wave", "bow"],
  "idle.greet": ["wave", "bow", "stretch"],
  "idle.courtesy": ["bow", "wave", "stretch"],
  "task.complete": ["wave", "bow"],
  "task.failed": ["bow"],
};

export function getAvailableAmbientChoices(
  availableMotions: readonly string[],
): CompanionMotionChoice[] {
  const available = new Set(availableMotions);
  return AMBIENT_CHOICES.filter((choice) => available.has(choice.motion));
}

export function resolveCompanionCueMotion(
  cue: CompanionCue,
  availableMotions: readonly string[],
): string | null {
  const available = new Set(availableMotions);
  return CUE_PREFERENCES[cue].find((motion) => available.has(motion)) ?? null;
}

export function chooseWeightedMotion(
  choices: readonly CompanionMotionChoice[],
  random: () => number,
): CompanionMotionChoice | null {
  if (choices.length === 0) return null;
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  const sample = normalizeRandom(random()) * total;
  let cursor = 0;
  for (const choice of choices) {
    cursor += choice.weight;
    if (sample < cursor) return choice;
  }
  return choices[choices.length - 1];
}

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999_999, Math.max(0, value));
}
