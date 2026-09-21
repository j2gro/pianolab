import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Midi } from "./midiLib";
import { formatTrackList, listMidiTracks, midiToLesson, type OverlapMode } from "./midiToLesson";
import { musicXmlFromBytes } from "./mxl";
import { creditTitle, musicXmlToLesson, type HandsMode } from "./musicXmlToLesson";
import type { Difficulty } from "./types";

type Flags = {
  listTracks: boolean;
  help: boolean;
  track?: number;
  id?: string;
  title?: string;
  composer?: string;
  grid?: number;
  phraseBars?: number;
  restBeats?: number;
  overlap?: OverlapMode;
  hands?: HandsMode;
  difficulty?: Difficulty;
  out?: string;
};

export function parseImportArgs(argv: string[]): { file?: string; flags: Flags } {
  const flags: Flags = { listTracks: false, help: false };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--list-tracks") {
      flags.listTracks = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    index += 1;
    if (key === "track") {
      flags.track = asInt(value, "track");
    } else if (key === "id") {
      flags.id = value;
    } else if (key === "title") {
      flags.title = value;
    } else if (key === "composer") {
      flags.composer = value;
    } else if (key === "grid") {
      flags.grid = asNumber(value, "grid");
    } else if (key === "phrase-bars") {
      flags.phraseBars = asNumber(value, "phrase-bars");
    } else if (key === "rest-beats") {
      flags.restBeats = asNumber(value, "rest-beats");
    } else if (key === "overlap") {
      if (value !== "highest" && value !== "lowest" && value !== "first") {
        throw new Error("--overlap must be highest, lowest, or first");
      }
      flags.overlap = value;
    } else if (key === "hands") {
      if (value !== "both" && value !== "melody" && value !== "left") {
        throw new Error("--hands must be both, melody, or left");
      }
      flags.hands = value;
    } else if (key === "difficulty") {
      if (value !== "beginner" && value !== "intermediate" && value !== "advanced") {
        throw new Error("--difficulty must be beginner, intermediate, or advanced");
      }
      flags.difficulty = value;
    } else if (key === "out") {
      flags.out = value;
    } else {
      throw new Error(`unknown flag --${key}`);
    }
  }

  return { file: positional[0], flags };
}

export function usage(): string {
  return `Usage: npm run lesson:import -- <file.mid|.mxl|.musicxml> [options]

  --list-tracks          Print MIDI track index, note count, channel, name
  --track N              MIDI melody track (default: most notes)
  --hands both           MusicXML staves: both | melody | left
  --difficulty beginner  beginner | intermediate | advanced
  --id slug              Lesson id (default: from filename)
  --title "Name"
  --composer "Name"
  --grid 16              Snap to 16th notes (4 / grid beats)
  --phrase-bars 4        New phrase every N bars (and at rests)
  --rest-beats 1         Split phrase on a rest of this many beats
  --overlap highest      MIDI chord picker: highest | lowest | first
  --out path.json        Write lesson JSON (default: stdout)

MIDI or MusicXML/MXL from MuseScore, LilyPond, Mutopia, IMSLP, MuseScore.com.
Do not commit copyrighted pop scores. Edit finger, lyric, and phrase titles after import.`;
}

export function slugFromPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "imported-lesson";
}

export function isMusicXmlPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".mxl" || ext === ".musicxml" || ext === ".xml";
}

function asInt(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new Error(`${label} must be an integer`);
  }
  return n;
}

function asNumber(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label} must be a number`);
  }
  return n;
}

function writeLesson(out: string | undefined, lesson: { notes: unknown[] }): void {
  const json = `${JSON.stringify(lesson, null, 2)}\n`;
  if (out) {
    writeFileSync(out, json);
    process.stderr.write(`Wrote ${out} (${lesson.notes.length} notes)\n`);
  } else {
    process.stdout.write(json);
  }
}

function run(argv: string[]): void {
  let parsed;
  try {
    parsed = parseImportArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (parsed.flags.help || !parsed.file) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = parsed.flags.help ? 0 : 1;
    return;
  }

  const id = parsed.flags.id ?? slugFromPath(parsed.file);

  if (isMusicXmlPath(parsed.file)) {
    const xml = musicXmlFromBytes(new Uint8Array(readFileSync(parsed.file)));
    const lesson = musicXmlToLesson(xml, {
      id,
      title: parsed.flags.title ?? creditTitle(xml) ?? id,
      composer: parsed.flags.composer ?? "Unknown",
      grid: parsed.flags.grid,
      phraseBars: parsed.flags.phraseBars,
      restBeats: parsed.flags.restBeats,
      hands: parsed.flags.hands,
      difficulty: parsed.flags.difficulty,
    });
    writeLesson(parsed.flags.out, lesson);
    return;
  }

  const midi = new Midi(readFileSync(parsed.file));

  if (parsed.flags.listTracks) {
    process.stdout.write(`${formatTrackList(listMidiTracks(midi))}\n`);
    return;
  }

  const lesson = midiToLesson(midi, {
    id,
    title: parsed.flags.title ?? id,
    composer: parsed.flags.composer ?? "Unknown",
    track: parsed.flags.track,
    grid: parsed.flags.grid,
    phraseBars: parsed.flags.phraseBars,
    restBeats: parsed.flags.restBeats,
    overlap: parsed.flags.overlap,
    difficulty: parsed.flags.difficulty,
  });

  writeLesson(parsed.flags.out, lesson);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  run(process.argv.slice(2));
}
