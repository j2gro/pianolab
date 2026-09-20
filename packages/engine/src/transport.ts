import type { LessonNote } from "@pianolab/lesson-schema";
import { isPitchHit } from "./matcher";
import type {
  DetectedNote,
  NoteVisualState,
  PracticeMode,
  TransportOptions,
  TransportSnapshot,
} from "./types";

const DEFAULT_EARLY_MS = 80;
const DEFAULT_LATE_MS = 150;
const DEFAULT_WRONG_FLASH_MS = 300;
const DEFAULT_STABLE_MS = 40;
const DEFAULT_CENTS = 60;

function beatToSec(beat: number, tempo: number): number {
  return (beat * 60) / tempo;
}

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function isTerminal(state: NoteVisualState): boolean {
  return state === "hit" || state === "missed";
}

export function createTransport(options: TransportOptions) {
  const notes = options.notes;
  const centsTolerance = options.centsTolerance ?? DEFAULT_CENTS;
  const earlyMs = options.earlyMs ?? DEFAULT_EARLY_MS;
  const lateMs = options.lateMs ?? DEFAULT_LATE_MS;
  const wrongFlashMs = options.wrongFlashMs ?? DEFAULT_WRONG_FLASH_MS;
  const stableMs = options.stableMs ?? DEFAULT_STABLE_MS;

  let tempo = options.tempo;
  let mode: PracticeMode = options.mode;
  let running = false;
  let startedAt = 0;
  let pauseAccum = 0;
  let userPausedAt: number | null = null;
  let lastTickSec = 0;
  let waitStartedAt: number | null = null;
  const waitDurationsMs: number[] = [];
  let hits = 0;
  let wrongs = 0;

  const states: Record<string, NoteVisualState> = {};
  const wrongUntil: Record<string, number> = {};
  for (const note of notes) {
    states[note.id] = "upcoming";
  }

  let stablePc: number | null = null;
  let stableSince = 0;
  let pendingAttacks: string[] = [];

  function now(): number {
    return options.now();
  }

  function musicalTime(): number {
    if (!running && userPausedAt === null && startedAt === 0) {
      return 0;
    }
    const t = now();
    if (userPausedAt !== null) {
      return Math.max(0, userPausedAt - startedAt - pauseAccum);
    }
    if (!running) {
      return lastTickSec;
    }
    return Math.max(0, t - startedAt - pauseAccum);
  }

  function currentUnresolved(): LessonNote | undefined {
    return notes.find((note) => !isTerminal(states[note.id]!));
  }

  function soundingNote(timeSec: number): LessonNote | undefined {
    return notes.find((note) => {
      const attack = beatToSec(note.beat, tempo);
      const end = attack + beatToSec(note.durationBeats, tempo);
      return timeSec + 1e-9 >= attack && timeSec < end;
    });
  }

  function applyWaitClamp(rawSec: number): { timeSec: number; waiting: boolean } {
    if (mode !== "wait") {
      return { timeSec: rawSec, waiting: false };
    }
    const current = currentUnresolved();
    if (!current) {
      return { timeSec: rawSec, waiting: false };
    }
    const attack = beatToSec(current.beat, tempo);
    if (rawSec > attack) {
      pauseAccum += rawSec - attack;
      return { timeSec: attack, waiting: true };
    }
    return { timeSec: rawSec, waiting: rawSec === attack && states[current.id] !== "hit" };
  }

  function setDueWindows(timeSec: number): void {
    const earlySec = earlyMs / 1000;
    const lateSec = lateMs / 1000;
    for (const note of notes) {
      const state = states[note.id]!;
      if (isTerminal(state)) {
        continue;
      }
      if (state === "waiting" && mode === "wait") {
        continue;
      }
      const attack = beatToSec(note.beat, tempo);
      if (state === "wrong") {
        if (mode === "play-along" && timeSec > attack + lateMs / 1000) {
          states[note.id] = "missed";
        }
        continue;
      }
      if (mode === "play-along") {
        if (timeSec > attack + lateSec) {
          states[note.id] = "missed";
        } else if (timeSec >= attack - earlySec) {
          states[note.id] = "due";
        } else {
          states[note.id] = "upcoming";
        }
      } else if (mode === "listen") {
        if (timeSec >= attack) {
          states[note.id] = "hit";
        } else if (timeSec >= attack - earlySec) {
          states[note.id] = "due";
        } else {
          states[note.id] = "upcoming";
        }
      } else {
        if (timeSec >= attack) {
          states[note.id] = "waiting";
        } else if (timeSec >= attack - earlySec) {
          states[note.id] = "due";
        } else {
          states[note.id] = "upcoming";
        }
      }
    }
  }

  function collectAttacks(prevSec: number, timeSec: number): string[] {
    const ids: string[] = [];
    for (const note of notes) {
      const attack = beatToSec(note.beat, tempo);
      if (prevSec < attack && timeSec >= attack) {
        ids.push(note.id);
      }
    }
    return ids;
  }

  function tick(): TransportSnapshot {
    const prevSec = lastTickSec;
    let timeSec = 0;
    let waiting = false;
    if (running || userPausedAt !== null) {
      const clamped = applyWaitClamp(musicalTime());
      timeSec = clamped.timeSec;
      waiting = clamped.waiting && running;
    }

    const current = currentUnresolved();
    if (waiting && current && waitStartedAt === null) {
      waitStartedAt = now();
    }

    const attacksThisTick = running ? collectAttacks(prevSec, timeSec) : [];
    for (const id of pendingAttacks) {
      if (!attacksThisTick.includes(id)) {
        attacksThisTick.push(id);
      }
    }
    pendingAttacks = [];
    setDueWindows(timeSec);

    if (mode === "listen") {
      for (const id of attacksThisTick) {
        if (states[id] !== "missed") {
          states[id] = "hit";
        }
      }
    }

    lastTickSec = timeSec;
    const complete =
      notes.length > 0 && notes.every((note) => isTerminal(states[note.id]!));

    const t = now();
    const wrongFlashIds = Object.entries(wrongUntil)
      .filter(([, until]) => until > t)
      .map(([id]) => id);

    return {
      timeSec,
      beat: (timeSec * tempo) / 60,
      running,
      waiting,
      complete,
      currentNoteId: current?.id ?? null,
      states: { ...states },
      wrongFlashIds,
      attacksThisTick,
    };
  }

  function reportDetected(detected: DetectedNote): void {
    if (!running || mode === "listen") {
      return;
    }

    const snap = tick();
    const current = currentUnresolved();
    if (!current) {
      return;
    }

    if (stablePc === pitchClass(detected.midi)) {
      // keep since
    } else {
      stablePc = pitchClass(detected.midi);
      stableSince = detected.t;
    }
    const stable = detected.t - stableSince >= stableMs / 1000 || stableMs === 0;
    if (!stable) {
      return;
    }

    const hit = isPitchHit(current.midi, detected, centsTolerance);

    if (mode === "wait") {
      if (!snap.waiting && states[current.id] !== "due" && states[current.id] !== "waiting") {
        return;
      }
      if (hit) {
        states[current.id] = "hit";
        hits += 1;
        if (waitStartedAt !== null) {
          waitDurationsMs.push(Math.round((now() - waitStartedAt) * 1000));
          waitStartedAt = null;
        }
        stablePc = null;
      } else {
        wrongUntil[current.id] = now() + wrongFlashMs / 1000;
        states[current.id] = "waiting";
        wrongs += 1;
      }
      return;
    }

    if (states[current.id] !== "due") {
      return;
    }
    if (hit) {
      states[current.id] = "hit";
      hits += 1;
      stablePc = null;
    } else {
      states[current.id] = "wrong";
      wrongUntil[current.id] = now() + wrongFlashMs / 1000;
      wrongs += 1;
    }
  }

  return {
    start() {
      const t = now();
      if (userPausedAt !== null) {
        pauseAccum += t - userPausedAt;
        userPausedAt = null;
        running = true;
        return;
      }
      startedAt = t;
      pauseAccum = 0;
      lastTickSec = -1;
      running = true;
    },
    pause() {
      if (!running) {
        return;
      }
      tick();
      userPausedAt = now();
      running = false;
    },
    setTempo(next: number) {
      tempo = next;
    },
    setMode(next: PracticeMode) {
      if (next === mode) {
        return;
      }
      const prev = mode;
      const timeSec = lastTickSec;
      mode = next;

      if (next === "wait") {
        const current = soundingNote(timeSec) ?? currentUnresolved();
        if (!current) {
          return;
        }
        const attack = beatToSec(current.beat, tempo);
        const end = attack + beatToSec(current.durationBeats, tempo);
        const stillOnNote = timeSec < end;
        if ((states[current.id] === "hit" || states[current.id] === "missed") && stillOnNote) {
          states[current.id] = "waiting";
        } else if (!isTerminal(states[current.id]!) && timeSec >= attack) {
          states[current.id] = "waiting";
        }
        const raw = musicalTime();
        if (raw > attack) {
          pauseAccum += raw - attack;
          lastTickSec = attack;
        }
        waitStartedAt = lastTickSec >= attack ? now() : null;
        return;
      }

      waitStartedAt = null;
      const current = currentUnresolved();
      if (!current) {
        return;
      }
      const attack = beatToSec(current.beat, tempo);
      if (prev === "wait" && next === "listen" && timeSec + 1e-9 >= attack) {
        states[current.id] = "hit";
        pendingAttacks.push(current.id);
      }
    },
    tick,
    reportDetected,
    stats() {
      return {
        hits,
        wrongs,
        waitsMs: [...waitDurationsMs],
      };
    },
  };
}

export type Transport = ReturnType<typeof createTransport>;
