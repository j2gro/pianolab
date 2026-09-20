export const LESSON_SCHEMA_VERSION = 1 as const;

export type LessonId = string;
export type Finger = 1 | 2 | 3 | 4 | 5;
export type Hand = "right";

export type LessonNote = {
  id: string;
  midi: number;
  beat: number;
  durationBeats: number;
  hand: Hand;
  finger: Finger;
  lyric?: string;
};

export type LessonPhrase = {
  id: string;
  title: string;
  noteIds: string[];
};

export type Lesson = {
  schemaVersion: typeof LESSON_SCHEMA_VERSION;
  id: LessonId;
  title: string;
  composer: string;
  timeSignature: [number, number];
  defaultTempo: number;
  notes: LessonNote[];
  phrases: LessonPhrase[];
};

export type LessonProgress = {
  lessonId: LessonId;
  hits: number;
  wrongs: number;
  waitsMs: number[];
  completedPhraseIds: string[];
  tempo: number;
  lastPhraseId: string | null;
};
