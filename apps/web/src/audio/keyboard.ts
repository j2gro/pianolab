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

export function startComputerKeyboard(
  now: () => number,
  onDetected: (note: DetectedNote) => void,
): () => void {
  const down = new Set<string>();
  const onDown = (event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const midi = KEY_TO_MIDI[event.key.toLowerCase()] ?? KEY_TO_MIDI[event.code.replace("Key", "").toLowerCase()];
    if (midi === undefined) {
      return;
    }
    event.preventDefault();
    down.add(event.key);
    onDetected({ midi, cents: 0, t: now() });
  };
  window.addEventListener("keydown", onDown, true);
  return () => window.removeEventListener("keydown", onDown, true);
}
