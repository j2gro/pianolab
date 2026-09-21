import { createRequire } from "node:module";
import type { Midi as MidiClass } from "@tonejs/midi";

const require = createRequire(import.meta.url);
const loaded = require("@tonejs/midi") as { Midi: typeof MidiClass };

export const Midi: typeof MidiClass = loaded.Midi;
