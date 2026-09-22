import type { LessonNote } from "@pianolab/lesson-schema";

export type PracticeMode = "listen" | "wait" | "play-along";

export type NoteVisualState =
  | "upcoming"
  | "due"
  | "waiting"
  | "hit"
  | "wrong"
  | "missed";

export type DetectedNote = {
  midi: number;
  cents: number;
  t: number;
};

/** What the transport did with a reported note. */
export type DetectionVerdict =
  | "hit"
  | "wrong"
  /** The transport is not running. */
  | "idle"
  /** Listen mode scores nothing. */
  | "listen-mode"
  /** Every note is already resolved. */
  | "lesson-done"
  /** Play-along: the note is not in its window. */
  | "not-due"
  /** Wait mode: the note is not being waited on. */
  | "not-expected";

export type TransportSnapshot = {
  timeSec: number;
  beat: number;
  running: boolean;
  waiting: boolean;
  complete: boolean;
  currentNoteId: string | null;
  states: Record<string, NoteVisualState>;
  wrongFlashIds: string[];
  attacksThisTick: string[];
};

export type TransportOptions = {
  notes: LessonNote[];
  tempo: number;
  mode: PracticeMode;
  now: () => number;
  /** Seconds of musical time before beat 0. Default 0. */
  leadInSec?: number;
  centsTolerance?: number;
  earlyMs?: number;
  lateMs?: number;
  wrongFlashMs?: number;
};
