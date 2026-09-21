import {
  LESSON_SCHEMA_VERSION,
  type Difficulty,
  type Finger,
  type Lesson,
  type LessonNote,
  type LessonPhrase,
} from "./types";
import { parseLesson } from "./parse";

export type OverlapMode = "highest" | "lowest" | "first";

export type MidiNoteLike = {
  midi: number;
  ticks: number;
  durationTicks: number;
};

export type MidiTrackLike = {
  name: string;
  channel: number;
  notes: MidiNoteLike[];
};

export type MidiLike = {
  header: {
    ppq: number;
    tempos: { bpm: number; ticks: number }[];
    timeSignatures: { timeSignature: number[]; ticks: number }[];
  };
  tracks: MidiTrackLike[];
};

export type MidiTrackInfo = {
  index: number;
  name: string;
  channel: number;
  noteCount: number;
};

export type MidiImportOptions = {
  id: string;
  title: string;
  composer: string;
  track?: number;
  grid?: number;
  phraseBars?: number;
  restBeats?: number;
  overlap?: OverlapMode;
  difficulty?: Difficulty;
};

type RawNote = {
  midi: number;
  beat: number;
  durationBeats: number;
  order: number;
};

const EPSILON = 1e-9;

export function listMidiTracks(midi: MidiLike): MidiTrackInfo[] {
  return midi.tracks.map((track, index) => ({
    index,
    name: track.name,
    channel: track.channel,
    noteCount: track.notes.length,
  }));
}

export function midiToLesson(midi: MidiLike, options: MidiImportOptions): Lesson {
  const grid = options.grid ?? 16;
  if (!(grid > 0) || !Number.isFinite(grid)) {
    throw new Error("grid must be a positive number");
  }
  const phraseBars = options.phraseBars ?? 4;
  if (!(phraseBars > 0) || !Number.isFinite(phraseBars)) {
    throw new Error("phraseBars must be a positive number");
  }
  const restBeats = options.restBeats ?? 1;
  const overlap = options.overlap ?? "highest";
  const step = 4 / grid;
  const ppq = midi.header.ppq;
  if (!(ppq > 0)) {
    throw new Error("MIDI header ppq must be > 0");
  }

  const track = pickTrack(midi, options.track);
  const quantized = track.notes
    .map((note, order) => toRawNote(note, order, ppq, step))
    .filter((note): note is RawNote => note !== null);

  const melody = collapseMonophonic(quantized, overlap, step);
  if (melody.length === 0) {
    throw new Error("selected MIDI track has no notes after import");
  }

  const timeSignature = readTimeSignature(midi);
  const defaultTempo = Math.round(midi.header.tempos[0]?.bpm ?? 120);
  const pad = Math.max(2, String(melody.length).length);
  const notes: LessonNote[] = melody.map((note, index) => ({
    id: `n${String(index + 1).padStart(pad, "0")}`,
    midi: note.midi,
    beat: note.beat,
    durationBeats: note.durationBeats,
    hand: "right",
    finger: fingerForMidi(note.midi),
  }));

  const lesson: Lesson = {
    schemaVersion: LESSON_SCHEMA_VERSION,
    id: options.id,
    title: options.title,
    composer: options.composer,
    timeSignature,
    defaultTempo,
    difficulty: options.difficulty ?? "beginner",
    notes,
    phrases: splitPhrases(notes, beatsPerBar(timeSignature), phraseBars, restBeats),
  };

  return parseLesson(lesson);
}

export function formatTrackList(tracks: MidiTrackInfo[]): string {
  if (tracks.length === 0) {
    return "No tracks.";
  }
  return tracks
    .map((track) => {
      const name = track.name.length > 0 ? track.name : "(unnamed)";
      return `${track.index}\tnotes=${track.noteCount}\tchannel=${track.channel}\tname=${name}`;
    })
    .join("\n");
}

function pickTrack(midi: MidiLike, trackIndex: number | undefined): MidiTrackLike {
  if (midi.tracks.length === 0) {
    throw new Error("MIDI file has no tracks");
  }
  if (trackIndex !== undefined) {
    const track = midi.tracks[trackIndex];
    if (!track) {
      throw new Error(`track ${trackIndex} is out of range (0-${midi.tracks.length - 1})`);
    }
    return track;
  }
  let bestIndex = 0;
  for (let index = 1; index < midi.tracks.length; index++) {
    if (midi.tracks[index]!.notes.length > midi.tracks[bestIndex]!.notes.length) {
      bestIndex = index;
    }
  }
  const best = midi.tracks[bestIndex]!;
  if (best.notes.length === 0) {
    throw new Error("MIDI file has no notes on any track");
  }
  return best;
}

function toRawNote(
  note: MidiNoteLike,
  order: number,
  ppq: number,
  step: number,
): RawNote | null {
  if (note.durationTicks <= 0) {
    return null;
  }
  const beat = quantize(note.ticks / ppq, step);
  const durationBeats = Math.max(step, quantize(note.durationTicks / ppq, step));
  const midi = Math.round(note.midi);
  if (midi < 0 || midi > 127) {
    return null;
  }
  return { midi, beat, durationBeats, order };
}

function quantize(beats: number, step: number): number {
  const snapped = Math.round(beats / step) * step;
  return roundBeats(snapped);
}

function roundBeats(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function collapseMonophonic(notes: RawNote[], overlap: OverlapMode, step: number): RawNote[] {
  const groups = new Map<number, RawNote[]>();
  for (const note of notes) {
    const list = groups.get(note.beat) ?? [];
    list.push(note);
    groups.set(note.beat, list);
  }

  const starts = [...groups.keys()].sort((a, b) => a - b);
  const picked: RawNote[] = [];
  for (const beat of starts) {
    const group = groups.get(beat)!;
    picked.push(chooseOverlap(group, overlap));
  }

  for (let index = 0; index < picked.length - 1; index++) {
    const current = picked[index]!;
    const next = picked[index + 1]!;
    const end = current.beat + current.durationBeats;
    if (end > next.beat + EPSILON) {
      current.durationBeats = Math.max(step, roundBeats(next.beat - current.beat));
    }
  }

  return picked.filter((note) => note.durationBeats > 0);
}

function chooseOverlap(group: RawNote[], overlap: OverlapMode): RawNote {
  if (group.length === 1) {
    return { ...group[0]! };
  }
  const sorted = [...group];
  if (overlap === "first") {
    sorted.sort((a, b) => a.order - b.order);
  } else if (overlap === "highest") {
    sorted.sort((a, b) => b.midi - a.midi || a.order - b.order);
  } else {
    sorted.sort((a, b) => a.midi - b.midi || a.order - b.order);
  }
  return { ...sorted[0]! };
}

export function splitPhrases(
  notes: LessonNote[],
  barBeats: number,
  phraseBars: number,
  restBeats: number,
): LessonPhrase[] {
  const phrases: LessonPhrase[] = [];
  let current: LessonNote[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const index = phrases.length + 1;
    phrases.push({
      id: `p${index}`,
      title: `Phrase ${index}`,
      noteIds: current.map((note) => note.id),
    });
    current = [];
  };

  for (const note of notes) {
    if (current.length > 0) {
      const prev = current.at(-1)!;
      const gap = note.beat - (prev.beat + prev.durationBeats);
      const startMeasure = Math.floor(current[0]!.beat / barBeats + EPSILON);
      const noteMeasure = Math.floor(note.beat / barBeats + EPSILON);
      if (gap >= restBeats - EPSILON || noteMeasure >= startMeasure + phraseBars) {
        flush();
      }
    }
    current.push(note);
  }
  flush();

  if (phrases.length === 0) {
    throw new Error("could not build phrases from imported notes");
  }
  return phrases;
}

function readTimeSignature(midi: MidiLike): [number, number] {
  const raw = midi.header.timeSignatures[0]?.timeSignature;
  const numerator = raw?.[0] ?? 4;
  const denominator = raw?.[1] ?? 4;
  if (!(numerator > 0) || !(denominator > 0)) {
    return [4, 4];
  }
  return [numerator, denominator];
}

function beatsPerBar(timeSignature: [number, number]): number {
  return timeSignature[0] * (4 / timeSignature[1]);
}

export function fingerForMidi(midi: number): Finger {
  const pitchClass = ((midi % 12) + 12) % 12;
  const white: Partial<Record<number, Finger>> = {
    0: 1,
    2: 2,
    4: 3,
    5: 4,
    7: 5,
    9: 4,
    11: 3,
  };
  return white[pitchClass] ?? 2;
}
