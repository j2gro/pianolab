import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  createTransport,
  isPitchHit,
  PITCH_EXPECTED_CENTS,
  PITCH_RMS_MIN,
  PLAY_ALONG_COUNT_IN_SEC,
  playAlongCountDigit,
  playAlongLeadInSec,
  type DetectedNote,
  type DetectionVerdict,
  type PracticeMode,
  type Transport,
  type TransportSnapshot,
} from "@pianolab/engine";
import {
  DIFFICULTY_LABEL,
  FULL_SONG_ID,
  notesForScope,
  remapPhraseToZero,
  type Difficulty,
  type Lesson,
  type LessonNote,
} from "@pianolab/lesson-schema";
import { KEY_TO_MIDI, startComputerKeyboard } from "../audio/keyboard";
import { startMicPitch, type MicHearing } from "../audio/mic";
import { startMidiAdapter } from "../audio/midiStub";
import { createPianoSynth } from "../audio/synth";
import {
  copyMicLog,
  downloadMicLog,
  installMicLogConsole,
  micLogEnabled,
  micLogSize,
  recordMicEvent,
  recordMicSetup,
  shouldSampleFrame,
  startMicLog,
  type MicContext,
} from "../audio/telemetry";
import { midiName } from "../piano/layout";
import { ErrorBoundary } from "../ErrorBoundary";
import type { KeyLight } from "../piano/PianoScene";
import { midisAtHitLine, rollClearedKeyboard } from "../piano/roll";

const PianoScene = lazy(async () => {
  const mod = await import("../piano/PianoScene");
  return { default: mod.PianoScene };
});

type Props = {
  lesson: Lesson;
  lessons: Lesson[];
  progressCompleted: string[];
  email: string;
  phraseId: string;
  mode: PracticeMode;
  tempo: number;
  onLesson: (id: string) => void;
  onPhrase: (id: string) => void;
  onMode: (mode: PracticeMode) => void;
  onTempo: (tempo: number) => void;
  onSignOut: () => void;
  onComplete: (stats: { hits: number; wrongs: number; waitsMs: number[] }) => void;
};

const DIFFICULTY_ORDER: Difficulty[] = ["beginner", "intermediate", "advanced"];

const MODES: { id: PracticeMode; label: string; short: string }[] = [
  { id: "listen", label: "Listen", short: "Listen" },
  { id: "play-along", label: "Play along", short: "Along" },
  { id: "wait", label: "Practice", short: "Practice" },
];

const DEFAULT_LEAD_IN_SEC = 2;

function leadInSecFor(mode: PracticeMode, tempo: number): number {
  if (mode === "play-along") {
    return playAlongLeadInSec(tempo);
  }
  return DEFAULT_LEAD_IN_SEC;
}

function durationSec(notes: LessonNote[], tempo: number): number {
  let end = 0;
  for (const note of notes) {
    end = Math.max(end, ((note.beat + note.durationBeats) * 60) / Math.max(1, tempo));
  }
  return Math.max(end, 0.01);
}

function formatPlayTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec + 1e-9));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function notesSoundingAt(notes: LessonNote[], timeSec: number, tempo: number): LessonNote[] {
  return notes.filter((note) => {
    const attack = (note.beat * 60) / Math.max(1, tempo);
    const end = attack + (note.durationBeats * 60) / Math.max(1, tempo);
    return timeSec + 1e-9 >= attack && timeSec < end;
  });
}

function emptySnapshot(notes: LessonNote[], tempo: number, mode: PracticeMode): TransportSnapshot {
  const states = Object.fromEntries(notes.map((note) => [note.id, "upcoming" as const]));
  const timeSec = -leadInSecFor(mode, tempo);
  return {
    timeSec,
    beat: (timeSec * tempo) / 60,
    running: false,
    waiting: false,
    complete: false,
    currentNoteId: notes[0]?.id ?? null,
    states,
    wrongFlashIds: [],
    attacksThisTick: [],
  };
}

function scopeTitle(lesson: Lesson, phraseId: string) {
  if (phraseId === FULL_SONG_ID) {
    return "Entire song";
  }
  return lesson.phrases.find((item) => item.id === phraseId)?.title ?? "Section";
}

function replayModeFromMidi(midi: number): PracticeMode | "same" {
  const pc = ((midi % 12) + 12) % 12;
  if (pc === 0) {
    return "listen";
  }
  if (pc === 2) {
    return "play-along";
  }
  if (pc === 4) {
    return "wait";
  }
  return "same";
}

function replayChoiceFromKey(key: string): PracticeMode | "same" | null {
  const letter = key.toLowerCase();
  if (letter === "c") {
    return "listen";
  }
  if (letter === "d") {
    return "play-along";
  }
  if (letter === "e") {
    return "wait";
  }
  const midi = KEY_TO_MIDI[letter] ?? KEY_TO_MIDI[key.toLowerCase()];
  if (midi !== undefined) {
    return replayModeFromMidi(midi);
  }
  if (letter === "enter" || letter === " " || letter.length === 1) {
    return "same";
  }
  return null;
}

function TempoSlider({ tempo, onTempo }: { tempo: number; onTempo: (tempo: number) => void }) {
  return (
    <label className="tempo-pill">
      <span>
        <span className="tempo-word">Tempo </span>
        {tempo}
      </span>
      <input
        type="range"
        min={50}
        max={140}
        value={tempo}
        aria-label="Tempo in BPM"
        onChange={(e) => onTempo(Number(e.target.value))}
      />
    </label>
  );
}

function SeekSlider({
  sliderTime,
  songDuration,
  started,
  onSeek,
}: {
  sliderTime: number;
  songDuration: number;
  started: boolean;
  onSeek: (timeSec: number) => void;
}) {
  return (
    <label className="tempo-pill seek-pill">
      <span>
        {formatPlayTime(sliderTime)}
        <span className="seek-total"> / {formatPlayTime(songDuration)}</span>
      </span>
      <input
        type="range"
        min={0}
        max={songDuration}
        step={0.05}
        value={sliderTime}
        disabled={!started}
        aria-label="Playback time"
        aria-valuetext={formatPlayTime(sliderTime)}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
    </label>
  );
}

export function PracticeView({
  lesson,
  lessons,
  progressCompleted,
  email,
  phraseId,
  mode,
  tempo,
  onLesson,
  onPhrase,
  onMode,
  onTempo,
  onSignOut,
  onComplete,
}: Props) {
  const notes = useMemo(
    () => remapPhraseToZero(notesForScope(lesson, phraseId)),
    [lesson, phraseId],
  );
  const [snapshot, setSnapshot] = useState(() => emptySnapshot(notes, tempo, mode));
  const [started, setStarted] = useState(false);
  const [heard, setHeard] = useState("Mic off — press Start");
  const [micError, setMicError] = useState<string | null>(null);
  const [status, setStatus] = useState("Press Start, then play or sing the highlighted note.");
  const [complete, setComplete] = useState(false);
  const [presses, setPresses] = useState<{ midi: number; ok: boolean; until: number; motionUntil: number }[]>([]);
  const [heldMidis, setHeldMidis] = useState<number[]>([]);
  const heldRef = useRef(new Set<number>());
  const [phraseOpen, setPhraseOpen] = useState(false);
  const [logNote, setLogNote] = useState("");
  const scoredRef = useRef(false);
  const completeRef = useRef(false);
  const replayBusyRef = useRef(false);
  const micReplayReadyRef = useRef(false);
  const modeRef = useRef(mode);
  const transportRef = useRef<Transport | null>(null);
  const synthRef = useRef<{ play: (midi: number, durationSec: number) => void; stopAll: () => void } | null>(null);
  const syncMicRef = useRef<() => void>(() => {});
  const cleanupRef = useRef<() => void>(() => {});
  const currentNoteIdRef = useRef<string | null>(notes[0]?.id ?? null);
  const detectRef = useRef<(note: DetectedNote, source: "mic" | "keys") => void>(() => {});
  const snapshotRef = useRef(snapshot);
  const micFrameRef = useRef<MicHearing | null>(null);
  const nowRef = useRef<() => number>(() => 0);
  const tempoRef = useRef(tempo);
  const playAgainRef = useRef<(next?: PracticeMode) => Promise<void>>(async () => {});
  const phraseMenuRef = useRef<HTMLDivElement>(null);
  const hudMoreRef = useRef<HTMLDetailsElement>(null);
  const done = new Set(progressCompleted);
  const title = scopeTitle(lesson, phraseId);
  tempoRef.current = tempo;
  modeRef.current = mode;
  completeRef.current = complete;

  const holdMidi = (midi: number) => {
    if (heldRef.current.has(midi)) {
      return;
    }
    heldRef.current.add(midi);
    setHeldMidis([...heldRef.current]);
  };

  const releaseMidi = (midi: number) => {
    if (!heldRef.current.delete(midi)) {
      return;
    }
    setHeldMidis([...heldRef.current]);
  };

  const playInput = (note: DetectedNote, source: "mic" | "keys" = "keys") => {
    if (completeRef.current) {
      if (source === "mic" && !micReplayReadyRef.current) {
        return;
      }
      const choice = replayModeFromMidi(note.midi);
      void playAgainRef.current(choice === "same" ? undefined : choice);
      return;
    }
    detectRef.current(note, source);
  };

  /** What the score was asking for, to read the mic log against. */
  const micContext = (): MicContext => {
    const snap = snapshotRef.current;
    const secPerBeat = 60 / Math.max(1, tempoRef.current);
    const expected = notes.find((item) => item.id === snap.currentNoteId) ?? null;
    const previous = expected ? (notes[notes.indexOf(expected) - 1] ?? null) : null;
    return {
      timeSec: snap.timeSec,
      waiting: snap.waiting,
      expectedId: expected?.id ?? null,
      expectedMidi: expected?.midi ?? null,
      expectedState: expected ? (snap.states[expected.id] ?? null) : null,
      sinceExpectedDue: expected ? snap.timeSec - expected.beat * secPerBeat : null,
      previousMidi: previous?.midi ?? null,
      sincePreviousDue: previous ? snap.timeSec - previous.beat * secPerBeat : null,
      sounding: notesSoundingAt(notes, snap.timeSec, tempoRef.current).map((item) => ({
        midi: item.midi,
        sinceAttack: snap.timeSec - item.beat * secPerBeat,
      })),
    };
  };

  const recordInput = (
    frame: MicHearing | null,
    source: "mic" | "keys",
    note: DetectedNote | null,
    verdict: DetectionVerdict | null,
  ) => {
    recordMicEvent({
      t: note?.t ?? frame?.t ?? 0,
      source,
      rms: frame?.rms ?? 0,
      noiseFloor: frame?.noiseFloor ?? 0,
      gate: frame?.gate ?? 0,
      midi: note?.midi ?? frame?.midi ?? null,
      cents: note?.cents ?? frame?.cents ?? null,
      attack: note !== null,
      verdict,
      pitch: frame?.pitch ?? null,
      onset: frame?.onset ?? null,
      context: micContext(),
    });
  };

  const start = async (sessionMode: PracticeMode = modeRef.current) => {
    setSnapshot({ ...emptySnapshot(notes, tempoRef.current, sessionMode), running: true });
    setStarted(true);
    setComplete(false);
    completeRef.current = false;
    micReplayReadyRef.current = false;
    scoredRef.current = false;
    if (sessionMode === "play-along") {
      setStatus(`Get ready · ${PLAY_ALONG_COUNT_IN_SEC}`);
    } else {
      setStatus("Get ready");
    }

    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.resume();
    const synth = createPianoSynth(ctx);
    const transport = createTransport({
      notes,
      tempo,
      mode: sessionMode,
      now: () => ctx.currentTime,
      leadInSec: leadInSecFor(sessionMode, tempo),
    });
    transport.start();
    const first = transport.tick();
    snapshotRef.current = first;
    setSnapshot(first);
    transportRef.current = transport;
    synthRef.current = synth;

    startMicLog({
      lesson: lesson.title,
      phrase: title,
      mode: sessionMode,
      tempo: tempoRef.current,
      score: notes.map((note) => ({
        id: note.id,
        name: midiName(note.midi),
        midi: note.midi,
        beat: note.beat,
        durationBeats: note.durationBeats,
      })),
    });

    const onHearing = (frame: MicHearing) => {
      micFrameRef.current = frame;
      // An attack is logged with its verdict once the transport has ruled on it.
      if (frame.attack === null && shouldSampleFrame(frame.pitch, frame.rms >= frame.gate)) {
        recordInput(frame, "mic", null, null);
      }
      const nowMs = performance.now();
      if (nowMs - lastHearMs < 80) {
        return;
      }
      lastHearMs = nowMs;
      if (completeRef.current && frame.midi === null) {
        micReplayReadyRef.current = true;
      }
      if (frame.midi === null) {
        setHeard(frame.rms > PITCH_RMS_MIN ? "Mic hears sound, no pitch yet" : "Mic on · play a note");
        return;
      }
      const detune = Math.round(frame.cents ?? 0);
      const sign = detune > 0 ? "+" : "";
      setHeard(`Heard ${midiName(frame.midi)} ${sign}${detune}¢`);
    };

    const onDetected = (note: DetectedNote, source: "mic" | "keys") => {
      const current = notes.find((item) => item.id === currentNoteIdRef.current);
      const ok = current ? isPitchHit(current.midi, note, PITCH_EXPECTED_CENTS) : false;
      const until = performance.now() + 1400;
      const motionUntil = performance.now() + 280;
      setPresses((prev) => {
        const nowMs = performance.now();
        return [
          ...prev.filter((press) => press.midi !== note.midi && press.until > nowMs),
          { midi: note.midi, ok, until, motionUntil },
        ];
      });
      setHeard(ok ? `Played ${midiName(note.midi)} — correct` : `Played ${midiName(note.midi)} — wrong`);
      const verdict = transport.reportDetected(note);
      recordInput(source === "mic" ? micFrameRef.current : null, source, note, verdict);
    };

    detectRef.current = onDetected;
    nowRef.current = () => ctx.currentTime;

    let raf = 0;
    let cleaned = false;
    let lastHearMs = 0;
    let micArmTimer = 0;
    let stopKeys = () => {};
    let stopMidi = () => {};
    let stopMic = () => {};
    let micOn = false;
    let micStarting = false;

    const micWanted = () => completeRef.current || modeRef.current !== "listen";

    const syncMic = () => {
      if (cleaned) {
        return;
      }
      if (!micWanted()) {
        if (micOn) {
          stopMic();
          stopMic = () => {};
          micOn = false;
          setHeard("Mic off · Listen");
        }
        return;
      }
      if (micOn || micStarting) {
        return;
      }
      micStarting = true;
      void startMicPitch(ctx, {
        onDetected: (note) => playInput(note, "mic"),
        onHearing,
        expectedMidi: () => {
          if (completeRef.current) {
            return null;
          }
          return notes.find((item) => item.id === currentNoteIdRef.current)?.midi ?? null;
        },
        previousMidi: () => {
          if (completeRef.current) {
            return null;
          }
          const index = notes.findIndex((item) => item.id === currentNoteIdRef.current);
          return index > 0 ? (notes[index - 1]?.midi ?? null) : null;
        },
        diagnostics: micLogEnabled(),
        onSetup: recordMicSetup,
      })
        .then((stop) => {
          micStarting = false;
          if (cleaned || !micWanted()) {
            stop();
            return;
          }
          stopMic = stop;
          micOn = true;
          setMicError(null);
          setHeard("Mic on · play a note");
        })
        .catch(() => {
          micStarting = false;
          setMicError("Mic unavailable — use computer keys A-K (C4–C5) or a MIDI device.");
        });
    };
    syncMicRef.current = syncMic;
    syncMic();

    const onReplayKey = (event: KeyboardEvent) => {
      if (!completeRef.current || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) {
        return;
      }
      const choice = replayChoiceFromKey(event.key);
      if (choice === null) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      void playAgainRef.current(choice === "same" ? undefined : choice);
    };
    window.addEventListener("keydown", onReplayKey, true);

    const loop = () => {
      if (cleaned) {
        return;
      }
      const snap = transport.tick();
      currentNoteIdRef.current = snap.currentNoteId;
      snapshotRef.current = snap;
      const nowMs = performance.now();
      setPresses((prev) => (prev.some((press) => press.until <= nowMs) ? prev.filter((press) => press.until > nowMs) : prev));
      if (modeRef.current === "listen") {
        for (const id of snap.attacksThisTick) {
          const note = notes.find((item) => item.id === id);
          if (note) {
            synth.play(note.midi, (note.durationBeats * 60) / tempoRef.current);
          }
        }
      }
      setSnapshot(snap);
      const current = notes.find((item) => item.id === snap.currentNoteId);
      if (!snap.running && !snap.complete && !scoredRef.current) {
        setStatus("Paused");
      } else if (snap.timeSec < 0 && !scoredRef.current) {
        const remain = playAlongCountDigit(snap.timeSec, tempoRef.current);
        setStatus(
          modeRef.current === "play-along" && remain !== null ? `Get ready · ${remain}` : "Get ready",
        );
      } else if (current && !scoredRef.current) {
        setStatus(
          snap.waiting
            ? `Waiting for ${midiName(current.midi)}${current.lyric ? ` (${current.lyric})` : ""}`
            : `${midiName(current.midi)}${current.lyric ? ` · ${current.lyric}` : ""}`,
        );
      }
      if (snap.complete && !scoredRef.current) {
        scoredRef.current = true;
        onComplete(transport.stats());
        setStatus(phraseId === FULL_SONG_ID ? "Song complete." : "Phrase complete.");
      }
      if (!snap.complete && (completeRef.current || scoredRef.current)) {
        completeRef.current = false;
        scoredRef.current = false;
        setComplete(false);
      }
      if (snap.complete && rollClearedKeyboard(notes, snap.beat) && !completeRef.current) {
        completeRef.current = true;
        micReplayReadyRef.current = false;
        setComplete(true);
        micArmTimer = window.setTimeout(() => {
          micReplayReadyRef.current = true;
        }, 450);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    stopKeys = startComputerKeyboard(
      () => nowRef.current(),
      (note) => {
        holdMidi(note.midi);
        playInput(note, "keys");
      },
      releaseMidi,
    );
    void startMidiAdapter(
      () => nowRef.current(),
      (note) => {
        holdMidi(note.midi);
        playInput(note, "keys");
      },
      releaseMidi,
    ).then((stop) => {
      stopMidi = stop;
    });

    const cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      detectRef.current = () => {};
      cancelAnimationFrame(raf);
      window.clearTimeout(micArmTimer);
      window.removeEventListener("keydown", onReplayKey, true);
      stopKeys();
      stopMidi();
      stopMic();
      transportRef.current = null;
      synthRef.current = null;
      heldRef.current.clear();
      setHeldMidis([]);
      void ctx.close();
    };
    cleanupRef.current = cleanup;
  };

  const playAgain = async (nextMode: PracticeMode = modeRef.current) => {
    if (replayBusyRef.current) {
      return;
    }
    replayBusyRef.current = true;
    if (nextMode !== modeRef.current) {
      onMode(nextMode);
    }
    cleanupRef.current();
    scoredRef.current = false;
    completeRef.current = false;
    setComplete(false);
    setSnapshot(emptySnapshot(notes, tempoRef.current, nextMode));
    setPresses([]);
    heldRef.current.clear();
    setHeldMidis([]);
    currentNoteIdRef.current = notes[0]?.id ?? null;
    try {
      await start(nextMode);
    } finally {
      replayBusyRef.current = false;
    }
  };
  playAgainRef.current = playAgain;

  const keyLights = useMemo(() => {
    const lights: Record<number, KeyLight> = {};
    for (const midi of midisAtHitLine(notes, snapshot.beat)) {
      lights[midi] = "expected";
    }
    const current = notes.find((item) => item.id === snapshot.currentNoteId);
    const currentState = current ? snapshot.states[current.id] : undefined;
    if (
      current &&
      (currentState === "due" || currentState === "waiting" || currentState === "wrong" || !started)
    ) {
      lights[current.midi] ??= "expected";
    }
    const nowMs = performance.now();
    for (const press of presses) {
      if (press.until > nowMs && !press.ok) {
        lights[press.midi] = "wrong";
      }
    }
    return lights;
  }, [notes, presses, snapshot.beat, snapshot.currentNoteId, snapshot.states, started]);

  const pressedMidis = useMemo(() => {
    const active = new Set(heldMidis);
    const nowMs = performance.now();
    for (const press of presses) {
      if (press.motionUntil > nowMs) {
        active.add(press.midi);
      }
    }
    for (const midi of midisAtHitLine(notes, snapshot.beat)) {
      active.add(midi);
    }
    return [...active];
  }, [heldMidis, notes, presses, snapshot.beat]);

  useEffect(() => {
    installMicLogConsole();
    return () => cleanupRef.current();
  }, []);

  useEffect(() => {
    if (started) {
      return;
    }
    setSnapshot(emptySnapshot(notes, tempo, mode));
  }, [mode, notes, started, tempo]);

  useEffect(() => {
    if (!started) {
      return;
    }
    transportRef.current?.setMode(mode);
    if (mode !== "listen") {
      synthRef.current?.stopAll();
    }
    if (mode === "wait") {
      const transport = transportRef.current;
      const snap = transport?.tick();
      if (transport && snap && !snap.running && !snap.complete) {
        transport.start();
      }
    }
    syncMicRef.current();
  }, [complete, mode, started]);

  useEffect(() => {
    transportRef.current?.setTempo(tempo);
  }, [tempo]);

  useEffect(() => {
    if (!phraseOpen) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      if (phraseMenuRef.current && !phraseMenuRef.current.contains(event.target as Node)) {
        setPhraseOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPhraseOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [phraseOpen]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const menu = hudMoreRef.current;
      if (menu && !menu.contains(event.target as Node)) {
        menu.open = false;
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && hudMoreRef.current) {
        hudMoreRef.current.open = false;
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const pickScope = (id: string) => {
    setPhraseOpen(false);
    if (id !== phraseId) {
      onPhrase(id);
    }
  };

  const canPause = started && !complete && (mode === "listen" || mode === "play-along");
  const countIn =
    started && !complete && mode === "play-along"
      ? playAlongCountDigit(snapshot.timeSec, tempo)
      : null;

  const togglePause = () => {
    const transport = transportRef.current;
    if (!transport || completeRef.current) {
      return;
    }
    if (modeRef.current !== "listen" && modeRef.current !== "play-along") {
      return;
    }
    const snap = transport.tick();
    if (snap.running) {
      transport.pause();
      synthRef.current?.stopAll();
    } else {
      transport.start();
    }
  };

  const restartPlayback = () => {
    const transport = transportRef.current;
    if (!transport) {
      return;
    }
    synthRef.current?.stopAll();
    scoredRef.current = false;
    completeRef.current = false;
    micReplayReadyRef.current = false;
    setComplete(false);
    setPresses([]);
    transport.restart();
    const snap = transport.tick();
    currentNoteIdRef.current = snap.currentNoteId;
    setSnapshot(snap);
    if (modeRef.current === "play-along") {
      setStatus(`Get ready · ${PLAY_ALONG_COUNT_IN_SEC}`);
    } else {
      setStatus("Get ready");
    }
  };

  const seekPlayback = (timeSec: number) => {
    const transport = transportRef.current;
    if (!transport) {
      return;
    }
    synthRef.current?.stopAll();
    transport.seek(timeSec);
    const snap = transport.tick();
    currentNoteIdRef.current = snap.currentNoteId;
    if (!snap.complete) {
      completeRef.current = false;
      scoredRef.current = false;
      setComplete(false);
    }
    if (modeRef.current === "listen" && snap.running) {
      const synth = synthRef.current;
      const remain = Math.max(0.05, durationSec(notes, tempoRef.current) - snap.timeSec);
      for (const note of notesSoundingAt(notes, snap.timeSec, tempoRef.current)) {
        const attack = (note.beat * 60) / tempoRef.current;
        const leftover = attack + (note.durationBeats * 60) / tempoRef.current - snap.timeSec;
        synth?.play(note.midi, Math.min(remain, Math.max(0.05, leftover)));
      }
    }
    setSnapshot(snap);
  };

  const songDuration = durationSec(notes, tempo);
  const sliderTime = Math.min(songDuration, Math.max(0, snapshot.timeSec));

  return (
    <div className="practice">
      <div className="hud">
        <div className="hud-meta">
          <button type="button" className="link hud-signout" onClick={onSignOut}>
            Sign out
          </button>
          <label className="song-picker">
            <span className="sr-only">Song</span>
            <select
              aria-label="Song"
              value={lesson.id}
              onChange={(event) => onLesson(event.target.value)}
            >
              {DIFFICULTY_ORDER.map((level) => {
                const items = lessons.filter((item) => item.difficulty === level);
                if (items.length === 0) {
                  return null;
                }
                return (
                  <optgroup key={level} label={DIFFICULTY_LABEL[level]}>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
          <span className="hud-email">{email}</span>
        </div>
        <div className="hud-pills">
          <div className="mode-toggle" role="radiogroup" aria-label="Practice mode">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-label={item.label}
                aria-checked={mode === item.id}
                className={mode === item.id ? "selected" : ""}
                onClick={() => onMode(item.id)}
              >
                <span className="mode-full">{item.label}</span>
                <span className="mode-compact">{item.short}</span>
              </button>
            ))}
          </div>
          <label className="mode-select">
            <span className="sr-only">Practice mode</span>
            <select
              aria-label="Practice mode"
              value={mode}
              onChange={(event) => onMode(event.target.value as PracticeMode)}
            >
              {MODES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.short}
                </option>
              ))}
            </select>
          </label>
          <div className="hud-bar-sliders">
            <TempoSlider tempo={tempo} onTempo={onTempo} />
            <SeekSlider
              sliderTime={sliderTime}
              songDuration={songDuration}
              started={started}
              onSeek={seekPlayback}
            />
          </div>
          {!started ? (
            <button type="button" className="hud-action" onClick={() => void start()}>
              Start
            </button>
          ) : canPause ? (
            <button type="button" className="secondary hud-action" onClick={togglePause}>
              {snapshot.running ? "Pause" : "Resume"}
            </button>
          ) : (
            <span className="pill hud-state">
              {complete ? "done" : snapshot.waiting ? "wait" : snapshot.running ? "play" : "idle"}
            </span>
          )}
          {started ? (
            <button type="button" className="secondary hud-action" onClick={restartPlayback}>
              Restart
            </button>
          ) : null}
          <details className="hud-more" ref={hudMoreRef}>
            <summary aria-label="More menu">More</summary>
            <div className="hud-more-panel">
              <div className="hud-more-sliders">
                <TempoSlider tempo={tempo} onTempo={onTempo} />
                <SeekSlider
                  sliderTime={sliderTime}
                  songDuration={songDuration}
                  started={started}
                  onSeek={seekPlayback}
                />
              </div>
              {micLogEnabled() ? (
                <div className="hud-more-log">
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      const frames = micLogSize();
                      void copyMicLog().then((copied) => {
                        setLogNote(copied ? `Copied ${frames} frames` : "Copy blocked — download it");
                      });
                    }}
                  >
                    Copy mic log
                  </button>
                  <button type="button" className="link" onClick={downloadMicLog}>
                    Save mic log
                  </button>
                  {logNote ? <span className="hint">{logNote}</span> : null}
                </div>
              ) : null}
              <p className="hud-email">{email}</p>
              <button type="button" className="link" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </details>
        </div>
      </div>
      <div className="scene">
        <div className="scene-fill">
          <ErrorBoundary>
            <Suspense fallback={<p className="hint">Loading piano-roll…</p>}>
              <PianoScene
                notes={notes}
                snapshot={snapshot}
                keyLights={keyLights}
                pressedMidis={pressedMidis}
                onPlayKey={(midi) => {
                  holdMidi(midi);
                  playInput({ midi, cents: 0, t: nowRef.current() }, "keys");
                }}
                onReleaseKey={releaseMidi}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
        <div className="scene-caption">
          <p className="status">{status}</p>
          {micError ? (
            <p className="hint">{micError}</p>
          ) : complete ? (
            <p className="hint">{heard}. Play C, D, or E to choose a mode, or any other note to repeat.</p>
          ) : mode === "listen" ? (
            <p className="hint">Listen mode does not use the mic until the song ends.</p>
          ) : (
            <p className="hint">{heard}</p>
          )}
        </div>
        <div className="phrase-dock" ref={phraseMenuRef}>
          <button
            type="button"
            className="phrase-pill"
            aria-haspopup="listbox"
            aria-expanded={phraseOpen}
            onClick={() => setPhraseOpen((open) => !open)}
          >
            {title}
          </button>
          {phraseOpen ? (
            <ul className="phrase-menu" role="listbox" aria-label="Song section">
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={phraseId === FULL_SONG_ID}
                  className={phraseId === FULL_SONG_ID ? "selected" : ""}
                  onClick={() => pickScope(FULL_SONG_ID)}
                >
                  Entire song
                </button>
              </li>
              {lesson.phrases.map((phrase) => (
                <li key={phrase.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={phraseId === phrase.id}
                    className={phraseId === phrase.id ? "selected" : ""}
                    onClick={() => pickScope(phrase.id)}
                  >
                    <span>{phrase.title}</span>
                    {done.has(phrase.id) ? <em>done</em> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {countIn !== null ? (
          <div className="count-in" role="status" aria-live="polite" aria-label={`Starting in ${countIn}`}>
            <strong>{countIn}</strong>
            <span>Get ready</span>
          </div>
        ) : null}
        {complete ? (
          <div className="replay-modal" role="dialog" aria-modal="true" aria-labelledby="replay-title">
            <h2 id="replay-title">{phraseId === FULL_SONG_ID ? "Song complete" : "Phrase complete"}</h2>
            <p>Play again?</p>
            <button type="button" onClick={() => void playAgain()}>
              Play again
            </button>
            <ul className="replay-keys">
              <li>
                <kbd>C</kbd> Listen
              </li>
              <li>
                <kbd>D</kbd> Play along
              </li>
              <li>
                <kbd>E</kbd> Practice
              </li>
            </ul>
            <p className="hint">
              Any other note or key repeats {MODES.find((item) => item.id === mode)?.label ?? "this mode"}.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
