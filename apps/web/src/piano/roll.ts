import type { LessonNote } from "@pianolab/lesson-schema";

export const Z_PER_BEAT = 0.95;
export const HIT_Z = 0;
export const LOOK_Z = 5.4;
export const KEY_DEPTH = 1.08;
export const KEY_BOTTOM_Z = HIT_Z - KEY_DEPTH;
export const KEY_CENTER_Z = HIT_Z - KEY_DEPTH / 2;

export function noteLength(note: LessonNote): number {
  return Math.max(0.28, note.durationBeats * Z_PER_BEAT * 0.88);
}

export function noteStartZ(note: LessonNote, beat: number): number {
  return HIT_Z + (note.beat - beat) * Z_PER_BEAT;
}

export function rollClearedKeyboard(notes: LessonNote[], beat: number): boolean {
  return notes.every((note) => noteStartZ(note, beat) + noteLength(note) < KEY_BOTTOM_Z);
}
