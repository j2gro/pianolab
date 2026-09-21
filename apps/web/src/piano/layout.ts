export const LOWEST_MIDI = 21;
export const HIGHEST_MIDI = 108;
export const WHITE_WIDTH = 0.12;

const BLACK_PC = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK_PC.has(((midi % 12) + 12) % 12);
}

export function whiteIndex(midi: number): number {
  let count = 0;
  for (let m = LOWEST_MIDI; m < midi; m++) {
    if (!isBlackKey(m)) {
      count += 1;
    }
  }
  return count;
}

export function whiteKeyCount(): number {
  let count = 0;
  for (let m = LOWEST_MIDI; m <= HIGHEST_MIDI; m++) {
    if (!isBlackKey(m)) {
      count += 1;
    }
  }
  return count;
}

export function keyboardWidth(): number {
  return whiteKeyCount() * WHITE_WIDTH;
}

/**
 * World X for a MIDI key.
 *
 * The top-down camera looks down −Y with +Z as screen-up, so camera +X is
 * world −X and world +X appears on the left of the screen. Placing lower
 * pitches at +X keeps bass on the player's left, like a real piano.
 *
 * Black keys sit in the gap between the surrounding whites (not mirrored onto
 * the previous white).
 */
export function keyX(midi: number): number {
  const clamped = Math.min(HIGHEST_MIDI, Math.max(LOWEST_MIDI, midi));
  const width = keyboardWidth();
  const whites = whiteIndex(clamped);
  const local = isBlackKey(clamped)
    ? whites * WHITE_WIDTH
    : whites * WHITE_WIDTH + WHITE_WIDTH * 0.5;
  return width / 2 - local;
}

/** Left-to-right screen X after the top-down camera's X flip (low pitch = left). */
export function keyScreenX(midi: number): number {
  return -keyX(midi);
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const PITCH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function pitchClassName(midi: number): string {
  return PITCH_NAMES[((midi % 12) + 12) % 12];
}

export function midiName(midi: number): string {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
