import {
  LESSON_SCHEMA_VERSION,
  type Finger,
  type Lesson,
  type LessonNote,
  type LessonPhrase,
} from "./types";

export class LessonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LessonParseError(`${label} must be a non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LessonParseError(`${label} must be a finite number`);
  }
  return value;
}

function asFinger(value: unknown, label: string): Finger {
  const n = asNumber(value, label);
  if (n !== 1 && n !== 2 && n !== 3 && n !== 4 && n !== 5) {
    throw new LessonParseError(`${label} must be 1-5`);
  }
  return n;
}

function parseNote(value: unknown, index: number): LessonNote {
  if (!isRecord(value)) {
    throw new LessonParseError(`notes[${index}] must be an object`);
  }
  const hand = asString(value.hand, `notes[${index}].hand`);
  if (hand !== "right") {
    throw new LessonParseError(`notes[${index}].hand must be "right"`);
  }
  const note: LessonNote = {
    id: asString(value.id, `notes[${index}].id`),
    midi: asNumber(value.midi, `notes[${index}].midi`),
    beat: asNumber(value.beat, `notes[${index}].beat`),
    durationBeats: asNumber(value.durationBeats, `notes[${index}].durationBeats`),
    hand,
    finger: asFinger(value.finger, `notes[${index}].finger`),
  };
  if (typeof value.lyric === "string") {
    note.lyric = value.lyric;
  }
  if (note.durationBeats <= 0) {
    throw new LessonParseError(`notes[${index}].durationBeats must be > 0`);
  }
  return note;
}

function parsePhrase(value: unknown, index: number): LessonPhrase {
  if (!isRecord(value)) {
    throw new LessonParseError(`phrases[${index}] must be an object`);
  }
  if (!Array.isArray(value.noteIds) || value.noteIds.length === 0) {
    throw new LessonParseError(`phrases[${index}].noteIds must be a non-empty array`);
  }
  return {
    id: asString(value.id, `phrases[${index}].id`),
    title: asString(value.title, `phrases[${index}].title`),
    noteIds: value.noteIds.map((id, j) =>
      asString(id, `phrases[${index}].noteIds[${j}]`),
    ),
  };
}

export function parseLesson(value: unknown): Lesson {
  if (!isRecord(value)) {
    throw new LessonParseError("lesson must be an object");
  }
  if (value.schemaVersion !== LESSON_SCHEMA_VERSION) {
    throw new LessonParseError(`schemaVersion must be ${LESSON_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.notes) || value.notes.length === 0) {
    throw new LessonParseError("notes must be a non-empty array");
  }
  if (!Array.isArray(value.phrases) || value.phrases.length === 0) {
    throw new LessonParseError("phrases must be a non-empty array");
  }
  if (!Array.isArray(value.timeSignature) || value.timeSignature.length !== 2) {
    throw new LessonParseError("timeSignature must be [beats, unit]");
  }

  const notes = value.notes.map(parseNote);
  const phrases = value.phrases.map(parsePhrase);

  const noteIds = new Set<string>();
  for (const note of notes) {
    if (noteIds.has(note.id)) {
      throw new LessonParseError(`duplicate note id ${note.id}`);
    }
    noteIds.add(note.id);
  }

  const covered = new Set<string>();
  for (const phrase of phrases) {
    for (const id of phrase.noteIds) {
      if (!noteIds.has(id)) {
        throw new LessonParseError(`phrase ${phrase.id} references missing note ${id}`);
      }
      if (covered.has(id)) {
        throw new LessonParseError(`note ${id} appears in more than one phrase`);
      }
      covered.add(id);
    }
  }

  if (covered.size !== noteIds.size) {
    throw new LessonParseError("phrases must cover every note in the lesson");
  }

  return {
    schemaVersion: LESSON_SCHEMA_VERSION,
    id: asString(value.id, "id"),
    title: asString(value.title, "title"),
    composer: asString(value.composer, "composer"),
    timeSignature: [
      asNumber(value.timeSignature[0], "timeSignature[0]"),
      asNumber(value.timeSignature[1], "timeSignature[1]"),
    ],
    defaultTempo: asNumber(value.defaultTempo, "defaultTempo"),
    notes,
    phrases,
  };
}

export const FULL_SONG_ID = "all";

export function notesForPhrase(lesson: Lesson, phraseId: string): LessonNote[] {
  const phrase = lesson.phrases.find((item) => item.id === phraseId);
  if (!phrase) {
    throw new LessonParseError(`unknown phrase ${phraseId}`);
  }
  const byId = new Map(lesson.notes.map((note) => [note.id, note]));
  return phrase.noteIds.map((id) => {
    const note = byId.get(id);
    if (!note) {
      throw new LessonParseError(`missing note ${id}`);
    }
    return note;
  });
}

export function notesForScope(lesson: Lesson, scopeId: string): LessonNote[] {
  if (scopeId === FULL_SONG_ID) {
    return [...lesson.notes].sort((a, b) => a.beat - b.beat);
  }
  return notesForPhrase(lesson, scopeId);
}

export function remapPhraseToZero(notes: LessonNote[]): LessonNote[] {
  const offset = notes[0]?.beat ?? 0;
  return notes.map((note) => ({ ...note, beat: note.beat - offset }));
}
