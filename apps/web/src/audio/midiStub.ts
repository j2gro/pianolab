import type { DetectedNote } from "@pianolab/engine";

type MidiMessageEvent = {
  data: Uint8Array | null;
};

type MidiInput = {
  addEventListener(type: "midimessage", listener: (event: MidiMessageEvent) => void): void;
  removeEventListener(type: "midimessage", listener: (event: MidiMessageEvent) => void): void;
};

type MidiAccess = {
  inputs: { forEach(cb: (input: MidiInput) => void): void };
};

export async function startMidiAdapter(
  now: () => number,
  onDetected: (note: DetectedNote) => void,
  onRelease?: (midi: number) => void,
): Promise<() => void> {
  const nav = navigator as Navigator & {
    requestMIDIAccess?: () => Promise<MidiAccess>;
  };
  if (!nav.requestMIDIAccess) {
    return () => {};
  }
  try {
    const access = await nav.requestMIDIAccess();
    const onMessage = (event: MidiMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 3) {
        return;
      }
      const status = data[0]! & 0xf0;
      const midi = data[1]!;
      const velocity = data[2]!;
      if (status === 0x90 && velocity > 0) {
        onDetected({ midi, cents: 0, t: now() });
        return;
      }
      if (status === 0x80 || (status === 0x90 && velocity === 0)) {
        onRelease?.(midi);
      }
    };
    access.inputs.forEach((input) => {
      input.addEventListener("midimessage", onMessage);
    });
    return () => {
      access.inputs.forEach((input) => {
        input.removeEventListener("midimessage", onMessage);
      });
    };
  } catch {
    return () => {};
  }
}
