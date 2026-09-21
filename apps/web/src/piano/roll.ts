import type { LessonNote } from "@pianolab/lesson-schema";

export const Z_PER_BEAT = 0.82;
export const HIT_Z = 0;
export const EAT_Z = HIT_Z + 0.022;
export const LOOK_Z = 5.4;
export const KEY_DEPTH = 0.65;
export const BLACK_KEY_DEPTH = KEY_DEPTH * 0.62;
export const KEY_BOTTOM_PAD = 0.06;
export const KEY_BOTTOM_Z = HIT_Z - KEY_DEPTH;
export const KEY_CENTER_Z = HIT_Z - KEY_DEPTH / 2;
export const BLACK_KEY_CENTER_Z = HIT_Z - BLACK_KEY_DEPTH / 2;

export function noteLength(note: LessonNote): number {
  return Math.max(0.28, note.durationBeats * Z_PER_BEAT * 0.88);
}

export function noteStartZ(note: LessonNote, beat: number): number {
  return HIT_Z + (note.beat - beat) * Z_PER_BEAT;
}

export function rollClearedKeyboard(notes: LessonNote[], beat: number): boolean {
  return notes.every((note) => noteStartZ(note, beat) + noteLength(note) < KEY_BOTTOM_Z);
}

export function noteInContact(note: LessonNote, beat: number): boolean {
  const startZ = noteStartZ(note, beat);
  const endZ = startZ + noteLength(note);
  return startZ <= EAT_Z + 0.02 && endZ >= EAT_Z;
}

export function midisAtHitLine(notes: LessonNote[], beat: number): number[] {
  const midis: number[] = [];
  const seen = new Set<number>();
  for (const note of notes) {
    if (!noteInContact(note, beat) || seen.has(note.midi)) {
      continue;
    }
    seen.add(note.midi);
    midis.push(note.midi);
  }
  return midis;
}
