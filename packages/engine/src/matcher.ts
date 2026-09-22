import type { DetectedNote } from "./types";

export function midiDistanceCents(expectedMidi: number, detected: DetectedNote): number {
  const heard = detected.midi + detected.cents / 100;
  return Math.abs(heard - expectedMidi) * 100;
}

export function isPitchHit(
  expectedMidi: number,
  detected: DetectedNote,
  centsTolerance = 50,
): boolean {
  return midiDistanceCents(expectedMidi, detected) <= centsTolerance;
}

export function frequencyToMidi(frequency: number): { midi: number; cents: number } {
  const midiFloat = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  return { midi, cents };
}

export function midiToFrequency(midi: number, cents = 0): number {
  return 440 * 2 ** ((midi - 69 + cents / 100) / 12);
}
