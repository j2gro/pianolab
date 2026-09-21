import {
  LESSON_SCHEMA_VERSION,
  type Difficulty,
  type Finger,
  type Hand,
  type Lesson,
  type LessonNote,
} from "./types";
import { parseLesson } from "./parse";
import { fingerForMidi, splitPhrases } from "./midiToLesson";
import { childElems, deepFind, firstElem, parseXml, textOf, type XmlElem } from "./xmlLite";

export type HandsMode = "both" | "melody" | "left";

export type MusicXmlImportOptions = {
  id: string;
  title: string;
  composer: string;
  grid?: number;
  phraseBars?: number;
  restBeats?: number;
  hands?: HandsMode;
  difficulty?: Difficulty;
};

type DraftNote = {
  midi: number;
  beat: number;
  durationBeats: number;
  hand: Hand;
  lyric?: string;
};

const STEP_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function musicXmlToLesson(xml: string, options: MusicXmlImportOptions): Lesson {
  const grid = options.grid ?? 16;
  if (!(grid > 0) || !Number.isFinite(grid)) {
    throw new Error("grid must be a positive number");
  }
  const phraseBars = options.phraseBars ?? 4;
  if (!(phraseBars > 0) || !Number.isFinite(phraseBars)) {
    throw new Error("phraseBars must be a positive number");
  }
  const restBeats = options.restBeats ?? 1;
  const step = 4 / grid;
  const hands = options.hands ?? "both";

  const doc = parseXml(xml);
  const part = firstElem(doc, "part") ?? deepFind(doc, "part")[0];
  if (!part) {
    throw new Error("MusicXML has no <part>");
  }

  let divisions = 1;
  let timeSignature: [number, number] = [4, 4];
  let tempo = 120;
  let measureBeat = 0;
  const drafts: DraftNote[] = [];

  for (const measure of childElems(part, "measure")) {
    let cursor = measureBeat;
    let lastNoteStart = measureBeat;
    for (const child of childElems(measure)) {
      if (child.name === "attributes") {
        const divText = textOf(child, "divisions");
        if (divText) {
          const next = Number(divText);
          if (next > 0) {
            divisions = next;
          }
        }
        const time = firstElem(child, "time");
        if (time) {
          const beats = Number(textOf(time, "beats"));
          const beatType = Number(textOf(time, "beat-type"));
          if (beats > 0 && beatType > 0) {
            timeSignature = [beats, beatType];
          }
        }
        continue;
      }
      if (child.name === "direction") {
        const sound = firstElem(child, "sound");
        const soundTempo = Number(sound?.attrs.tempo ?? "");
        if (soundTempo > 0) {
          tempo = Math.round(soundTempo);
        }
        const metronome = firstElem(firstElem(child, "direction-type") ?? child, "metronome");
        const perMinute = Number(metronome ? textOf(metronome, "per-minute") : "");
        if (perMinute > 0) {
          tempo = Math.round(perMinute);
        }
        continue;
      }
      if (child.name === "backup") {
        cursor -= durationToBeats(child, divisions);
        continue;
      }
      if (child.name === "forward") {
        cursor += durationToBeats(child, divisions);
        continue;
      }
      if (child.name !== "note") {
        continue;
      }
      const durationBeats = durationToBeats(child, divisions);
      const isChord = firstElem(child, "chord") !== undefined;
      const start = isChord ? lastNoteStart : cursor;
      if (!isChord) {
        lastNoteStart = start;
        cursor = start + durationBeats;
      }
      if (firstElem(child, "rest") || firstElem(child, "grace")) {
        continue;
      }
      const pitch = firstElem(child, "pitch");
      if (!pitch) {
        continue;
      }
      const midi = pitchToMidi(pitch);
      if (midi === null) {
        continue;
      }
      const staff = Number(textOf(child, "staff") || "1");
      const hand: Hand = staff >= 2 ? "left" : "right";
      if (hands === "melody" && hand !== "right") {
        continue;
      }
      if (hands === "left" && hand !== "left") {
        continue;
      }
      const lyric = lyricText(child);
      drafts.push({
        midi,
        beat: quantize(start, step),
        durationBeats: Math.max(step, quantize(durationBeats, step)),
        hand,
        lyric,
      });
    }
    measureBeat += timeSignature[0] * (4 / timeSignature[1]);
  }

  if (drafts.length === 0) {
    throw new Error("MusicXML has no pitched notes after import");
  }

  drafts.sort((a, b) => a.beat - b.beat || b.midi - a.midi || (a.hand === "right" ? -1 : 1));
  const pad = Math.max(2, String(drafts.length).length);
  const notes: LessonNote[] = drafts.map((note, index) => {
    const item: LessonNote = {
      id: `n${String(index + 1).padStart(pad, "0")}`,
      midi: note.midi,
      beat: note.beat,
      durationBeats: note.durationBeats,
      hand: note.hand,
      finger: fingerForHand(note.midi, note.hand),
    };
    if (note.lyric) {
      item.lyric = note.lyric;
    }
    return item;
  });

  const barBeats = timeSignature[0] * (4 / timeSignature[1]);
  const lesson: Lesson = {
    schemaVersion: LESSON_SCHEMA_VERSION,
    id: options.id,
    title: options.title,
    composer: options.composer,
    timeSignature,
    defaultTempo: tempo,
    difficulty: options.difficulty ?? "beginner",
    notes,
    phrases: splitPhrases(notes, barBeats, phraseBars, restBeats),
  };

  return parseLesson(lesson);
}

export function creditTitle(xml: string): string | undefined {
  try {
    const doc = parseXml(xml);
    const words = deepFind(doc, "credit-words")
      .map((el) => textOf(el))
      .filter((text) => text.length > 0 && text.toLowerCase() !== "public domain");
    return words[0];
  } catch {
    return undefined;
  }
}

export function creditComposer(xml: string): string | undefined {
  try {
    const doc = parseXml(xml);
    const creators = deepFind(doc, "creator");
    const preferred = creators.find((el) => (el.attrs.type ?? "").toLowerCase() === "composer") ?? creators[0];
    const text = preferred ? textOf(preferred) : "";
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function durationToBeats(el: XmlElem, divisions: number): number {
  const raw = Number(textOf(el, "duration"));
  if (!(raw > 0) || !(divisions > 0)) {
    return 0;
  }
  return raw / divisions;
}

function pitchToMidi(pitch: XmlElem): number | null {
  const step = textOf(pitch, "step").toUpperCase();
  const octave = Number(textOf(pitch, "octave"));
  const alter = Number(textOf(pitch, "alter") || "0");
  const pc = STEP_PC[step];
  if (pc === undefined || !Number.isInteger(octave)) {
    return null;
  }
  const midi = (octave + 1) * 12 + pc + alter;
  if (midi < 0 || midi > 127) {
    return null;
  }
  return Math.round(midi);
}

function lyricText(note: XmlElem): string | undefined {
  const lyric = firstElem(note, "lyric");
  const text = lyric ? textOf(lyric, "text") : "";
  return text.length > 0 ? text : undefined;
}

function quantize(beats: number, step: number): number {
  return Math.round(Math.round(beats / step) * step * 1e6) / 1e6;
}

function fingerForHand(midi: number, hand: Hand): Finger {
  if (hand === "right") {
    return fingerForMidi(midi);
  }
  const pitchClass = ((midi % 12) + 12) % 12;
  const white: Partial<Record<number, Finger>> = {
    0: 5,
    2: 4,
    4: 3,
    5: 2,
    7: 1,
    9: 2,
    11: 3,
  };
  return white[pitchClass] ?? 2;
}
