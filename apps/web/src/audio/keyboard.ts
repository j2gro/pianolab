import type { DetectedNote } from "@pianolab/engine";

export const KEY_TO_MIDI: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
};

function midiFromKey(key: string, code: string): number | undefined {
  return KEY_TO_MIDI[key.toLowerCase()] ?? KEY_TO_MIDI[code.replace("Key", "").toLowerCase()];
}

export function startComputerKeyboard(
  now: () => number,
  onDetected: (note: DetectedNote) => void,
  onRelease?: (midi: number) => void,
): () => void {
  const down = new Map<string, number>();
  const onDown = (event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const midi = midiFromKey(event.key, event.code);
    if (midi === undefined) {
      return;
    }
    event.preventDefault();
    down.set(event.key, midi);
    onDetected({ midi, cents: 0, t: now() });
  };
  const onUp = (event: KeyboardEvent) => {
    const midi = down.get(event.key) ?? midiFromKey(event.key, event.code);
    if (midi === undefined) {
      return;
    }
    down.delete(event.key);
    onRelease?.(midi);
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keyup", onUp, true);
  return () => {
    window.removeEventListener("keydown", onDown, true);
    window.removeEventListener("keyup", onUp, true);
  };
}
