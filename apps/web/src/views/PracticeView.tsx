import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  createTransport,
  isPitchHit,
  type DetectedNote,
  type PracticeMode,
  type Transport,
  type TransportSnapshot,
} from "@pianolab/engine";
import {
  FULL_SONG_ID,
  notesForScope,
  remapPhraseToZero,
  type Lesson,
  type LessonNote,
} from "@pianolab/lesson-schema";
import { KEY_TO_MIDI, startComputerKeyboard } from "../audio/keyboard";
import { startMicPitch, type MicHearing } from "../audio/mic";
import { startMidiAdapter } from "../audio/midiStub";
import { createPianoSynth } from "../audio/synth";
import { midiName } from "../piano/layout";
import { ErrorBoundary } from "../ErrorBoundary";
import type { KeyLight } from "../piano/PianoScene";
import { rollClearedKeyboard } from "../piano/roll";

const PianoScene = lazy(async () => {
  const mod = await import("../piano/PianoScene");
  return { default: mod.PianoScene };
});

type Props = {
  lesson: Lesson;
  progressCompleted: string[];
  email: string;
  phraseId: string;
  mode: PracticeMode;
  tempo: number;
  onPhrase: (id: string) => void;
  onMode: (mode: PracticeMode) => void;
  onTempo: (tempo: number) => void;
  onSignOut: () => void;
  onComplete: (stats: { hits: number; wrongs: number; waitsMs: number[] }) => void;
};

const MODES: { id: PracticeMode; label: string }[] = [
  { id: "listen", label: "Listen" },
  { id: "play-along", label: "Play along" },
  { id: "wait", label: "Practice" },
];

function emptySnapshot(notes: LessonNote[]): TransportSnapshot {
  const states = Object.fromEntries(notes.map((note) => [note.id, "upcoming" as const]));
  return {
    timeSec: 0,
    beat: 0,
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

export function PracticeView({
  lesson,
  progressCompleted,
  email,
  phraseId,
  mode,
  tempo,
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
  const [snapshot, setSnapshot] = useState(() => emptySnapshot(notes));
  const [started, setStarted] = useState(false);
  const [heard, setHeard] = useState("Mic off — press Start");
  const [micError, setMicError] = useState<string | null>(null);
  const [status, setStatus] = useState("Press Start, then play or sing the highlighted note.");
  const [complete, setComplete] = useState(false);
  const [presses, setPresses] = useState<{ midi: number; ok: boolean; until: number }[]>([]);
  const [phraseOpen, setPhraseOpen] = useState(false);
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
  const detectRef = useRef<(note: DetectedNote) => void>(() => {});
  const nowRef = useRef<() => number>(() => 0);
  const playAgainRef = useRef<(next?: PracticeMode) => Promise<void>>(async () => {});
  const phraseMenuRef = useRef<HTMLDivElement>(null);
  const done = new Set(progressCompleted);
  const title = scopeTitle(lesson, phraseId);
  modeRef.current = mode;
  completeRef.current = complete;

  const playInput = (note: DetectedNote, source: "mic" | "keys" = "keys") => {
    if (completeRef.current) {
      if (source === "mic" && !micReplayReadyRef.current) {
        return;
      }
      const choice = replayModeFromMidi(note.midi);
      void playAgainRef.current(choice === "same" ? undefined : choice);
      return;
    }
    detectRef.current(note);
  };

  const start = async (sessionMode: PracticeMode = modeRef.current) => {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.resume();
    const synth = createPianoSynth(ctx);
    const transport = createTransport({
      notes,
      tempo,
      mode: sessionMode,
      now: () => ctx.currentTime,
    });
    transport.start();
    transportRef.current = transport;
    synthRef.current = synth;
    setStarted(true);
    setComplete(false);
    completeRef.current = false;
    micReplayReadyRef.current = false;
    scoredRef.current = false;

    const onHearing = (frame: MicHearing) => {
      const nowMs = performance.now();
      if (nowMs - lastHearMs < 80) {
        return;
      }
      lastHearMs = nowMs;
      if (completeRef.current && frame.midi === null) {
        micReplayReadyRef.current = true;
      }
      if (frame.midi === null) {
        setHeard(frame.rms > 0.003 ? "Mic hears sound, no pitch yet" : "Mic on · play a note");
        return;
      }
      const detune = Math.round(frame.cents ?? 0);
      const sign = detune > 0 ? "+" : "";
      setHeard(`Heard ${midiName(frame.midi)} ${sign}${detune}¢`);
    };

    const onDetected = (note: { midi: number; cents: number; t: number }) => {
      const current = notes.find((item) => item.id === currentNoteIdRef.current);
      const ok = current ? isPitchHit(current.midi, note, 50) : false;
      const until = performance.now() + 1400;
      setPresses((prev) => {
        const nowMs = performance.now();
        return [...prev.filter((press) => press.midi !== note.midi && press.until > nowMs), { midi: note.midi, ok, until }];
      });
      setHeard(ok ? `Played ${midiName(note.midi)} — correct` : `Played ${midiName(note.midi)} — wrong`);
      transport.reportDetected(note);
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
      void startMicPitch(ctx, (note) => playInput(note, "mic"), onHearing)
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
      const nowMs = performance.now();
      setPresses((prev) => (prev.some((press) => press.until <= nowMs) ? prev.filter((press) => press.until > nowMs) : prev));
      if (modeRef.current === "listen") {
        for (const id of snap.attacksThisTick) {
          const note = notes.find((item) => item.id === id);
          if (note) {
            synth.play(note.midi, (note.durationBeats * 60) / tempo);
          }
        }
      }
      setSnapshot(snap);
      const current = notes.find((item) => item.id === snap.currentNoteId);
      if (current && !scoredRef.current) {
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

    stopKeys = startComputerKeyboard(() => nowRef.current(), (note) => playInput(note, "keys"));
    void startMidiAdapter(() => nowRef.current(), (note) => playInput(note, "keys")).then((stop) => {
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
    setSnapshot(emptySnapshot(notes));
    setPresses([]);
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
    const current = notes.find((item) => item.id === snapshot.currentNoteId);
    const currentState = current ? snapshot.states[current.id] : undefined;
    if (
      current &&
      (currentState === "due" || currentState === "waiting" || currentState === "wrong" || !started)
    ) {
      lights[current.midi] = "expected";
    }
    const nowMs = performance.now();
    for (const press of presses) {
      if (press.until > nowMs) {
        lights[press.midi] = press.ok ? "correct" : "wrong";
      }
    }
    return lights;
  }, [notes, presses, snapshot.currentNoteId, snapshot.states, started]);

  useEffect(() => {
    return () => cleanupRef.current();
  }, []);

  useEffect(() => {
    if (!started) {
      return;
    }
    transportRef.current?.setMode(mode);
    if (mode !== "listen") {
      synthRef.current?.stopAll();
    }
    syncMicRef.current();
  }, [complete, mode, started]);

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

  const pickScope = (id: string) => {
    setPhraseOpen(false);
    if (id !== phraseId) {
      onPhrase(id);
    }
  };

  return (
    <div className="practice">
      <div className="hud">
        <div className="hud-meta">
          <button type="button" className="link" onClick={onSignOut}>
            Sign out
          </button>
          <div>
            <strong>{lesson.title}</strong>
            <span>
              {email} · {tempo} BPM
            </span>
          </div>
        </div>
        <div className="mode-toggle" role="radiogroup" aria-label="Practice mode">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={mode === item.id}
              className={mode === item.id ? "selected" : ""}
              onClick={() => onMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {!started ? (
          <button type="button" onClick={() => void start()}>
            Start
          </button>
        ) : (
          <span className="pill">
            {complete ? "complete" : snapshot.waiting ? "waiting" : snapshot.running ? "playing" : "idle"}
          </span>
        )}
      </div>
      <p className="status">{status}</p>
      {micError ? (
        <p className="hint">{micError}</p>
      ) : complete ? (
        <p className="hint">{heard}. Play C, D, or E to choose a mode, or any other note to repeat.</p>
      ) : mode === "listen" ? (
        <p className="hint">Listen mode does not use the mic until the song ends. Switch to Practice to play along.</p>
      ) : (
        <p className="hint">{heard}. Any octave of the expected note counts. Keys A–K also work.</p>
      )}
      <label className="tempo-inline">
        Tempo {tempo} BPM
        <input
          type="range"
          min={50}
          max={140}
          value={tempo}
          onChange={(e) => onTempo(Number(e.target.value))}
        />
      </label>
      <div className="scene">
        <div className="scene-fill">
          <ErrorBoundary>
            <Suspense fallback={<p className="hint">Loading piano-roll…</p>}>
              <PianoScene
                notes={notes}
                snapshot={snapshot}
                keyLights={keyLights}
                onPlayKey={(midi) => playInput({ midi, cents: 0, t: nowRef.current() }, "keys")}
              />
            </Suspense>
          </ErrorBoundary>
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
