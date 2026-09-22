import type { LessonNote } from "@pianolab/lesson-schema";
import { isPitchHit } from "./matcher";
import type {
  DetectedNote,
  DetectionVerdict,
  NoteVisualState,
  PracticeMode,
  TransportOptions,
  TransportSnapshot,
} from "./types";

const DEFAULT_EARLY_MS = 80;
const DEFAULT_LATE_MS = 150;
const DEFAULT_WRONG_FLASH_MS = 300;
const DEFAULT_CENTS = 60;

function beatToSec(beat: number, tempo: number): number {
  return (beat * 60) / tempo;
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

  let tempo = options.tempo;
  let mode: PracticeMode = options.mode;
  const leadInSec = Math.max(0, options.leadInSec ?? 0);
  let running = false;
  let startedAt = 0;
  let pauseAccum = 0;
  let userPausedAt: number | null = null;
  let lastTickSec = 0;
  let waitStartedAt: number | null = null;
  let waitFreezeSec: number | null = null;
  const waitDurationsMs: number[] = [];
  let hits = 0;
  let wrongs = 0;

  const states: Record<string, NoteVisualState> = {};
  const wrongUntil: Record<string, number> = {};
  for (const note of notes) {
    states[note.id] = "upcoming";
  }

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
      return userPausedAt - startedAt - pauseAccum;
    }
    if (!running) {
      return lastTickSec;
    }
    return t - startedAt - pauseAccum;
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
      waitFreezeSec = null;
      return { timeSec: rawSec, waiting: false };
    }
    const attack = beatToSec(current.beat, tempo);
    if (rawSec >= attack) {
      const freezeAt =
        waitFreezeSec !== null && waitFreezeSec >= attack ? waitFreezeSec : attack;
      if (rawSec > freezeAt) {
        pauseAccum += rawSec - freezeAt;
      }
      return { timeSec: freezeAt, waiting: true };
    }
    waitFreezeSec = null;
    return { timeSec: rawSec, waiting: false };
  }

  function setMusicalTime(timeSec: number): void {
    const t = now();
    if (userPausedAt !== null) {
      pauseAccum = userPausedAt - startedAt - timeSec;
    } else if (running) {
      pauseAccum = t - startedAt - timeSec;
    } else {
      startedAt = t - timeSec;
      pauseAccum = 0;
    }
    lastTickSec = timeSec;
  }

  function rebuildStatesFromTime(timeSec: number): void {
    pendingAttacks = [];
    for (const id of Object.keys(wrongUntil)) {
      delete wrongUntil[id];
    }
    const earlySec = earlyMs / 1000;
    const lateSec = lateMs / 1000;
    for (const note of notes) {
      const attack = beatToSec(note.beat, tempo);
      const end = attack + beatToSec(note.durationBeats, tempo);
      if (mode === "wait") {
        if (end <= timeSec) {
          states[note.id] = "hit";
        } else if (timeSec >= attack) {
          states[note.id] = "waiting";
        } else if (timeSec >= attack - earlySec) {
          states[note.id] = "due";
        } else {
          states[note.id] = "upcoming";
        }
        continue;
      }
      if (mode === "listen") {
        if (timeSec >= attack) {
          states[note.id] = "hit";
        } else if (timeSec >= attack - earlySec) {
          states[note.id] = "due";
        } else {
          states[note.id] = "upcoming";
        }
        continue;
      }
      if (timeSec > attack + lateSec) {
        states[note.id] = "missed";
      } else if (timeSec >= attack - earlySec) {
        states[note.id] = "due";
      } else {
        states[note.id] = "upcoming";
      }
    }
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

  function reportDetected(detected: DetectedNote): DetectionVerdict {
    if (!running) {
      return "idle";
    }
    if (mode === "listen") {
      return "listen-mode";
    }

    const snap = tick();
    const current = currentUnresolved();
    if (!current) {
      return "lesson-done";
    }

    const hit = isPitchHit(current.midi, detected, centsTolerance);

    if (mode === "wait") {
      const expected = snap.waiting || states[current.id] === "due" || states[current.id] === "waiting";
      if (hit) {
        states[current.id] = "hit";
        hits += 1;
        if (waitStartedAt !== null) {
          waitDurationsMs.push(Math.round((now() - waitStartedAt) * 1000));
          waitStartedAt = null;
        }
        waitFreezeSec = null;
        return "hit";
      }
      if (expected) {
        wrongUntil[current.id] = now() + wrongFlashMs / 1000;
        states[current.id] = "waiting";
        wrongs += 1;
        return "wrong";
      }
      return "not-expected";
    }

    if (states[current.id] !== "due") {
      return "not-due";
    }
    if (hit) {
      states[current.id] = "hit";
      hits += 1;
      return "hit";
    }
    states[current.id] = "wrong";
    wrongUntil[current.id] = now() + wrongFlashMs / 1000;
    wrongs += 1;
    return "wrong";
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
      startedAt = t + leadInSec;
      pauseAccum = 0;
      lastTickSec = -leadInSec - 1e-6;
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
    restart() {
      for (const note of notes) {
        states[note.id] = "upcoming";
        delete wrongUntil[note.id];
      }
      hits = 0;
      wrongs = 0;
      waitDurationsMs.length = 0;
      waitStartedAt = null;
      waitFreezeSec = null;
      pendingAttacks = [];
      userPausedAt = null;
      startedAt = now() + leadInSec;
      pauseAccum = 0;
      lastTickSec = -leadInSec - 1e-6;
      running = true;
    },
    seek(timeSec: number) {
      const next = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
      rebuildStatesFromTime(next);
      setMusicalTime(next);
      const current = currentUnresolved();
      const attack = current ? beatToSec(current.beat, tempo) : 0;
      if (mode === "wait" && current && next >= attack) {
        waitFreezeSec = next;
        waitStartedAt = now();
      } else {
        waitFreezeSec = null;
        waitStartedAt = null;
      }
    },
    setTempo(next: number) {
      if (next <= 0 || next === tempo) {
        return;
      }
      const raw = musicalTime();
      const beat = (raw * tempo) / 60;
      const prevBeat = (Math.max(0, lastTickSec) * tempo) / 60;
      tempo = next;
      const newTimeSec = beatToSec(beat, tempo);
      if (lastTickSec >= 0) {
        lastTickSec = beatToSec(prevBeat, tempo);
      }
      if (userPausedAt !== null) {
        pauseAccum = userPausedAt - startedAt - newTimeSec;
      } else if (running) {
        pauseAccum = now() - startedAt - newTimeSec;
      }
    },
    setMode(next: PracticeMode) {
      if (next === mode) {
        return;
      }
      const prev = mode;
      const timeSec = lastTickSec;
      mode = next;

      waitFreezeSec = null;
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
