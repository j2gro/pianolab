import assert from "node:assert/strict";
import { test } from "node:test";
import type { LessonNote } from "@pianolab/lesson-schema";
import { isPitchHit } from "./matcher";
import { playAlongCountDigit, playAlongLeadInSec } from "./countIn";
import { createTransport } from "./transport";
import { frequencyToMidi } from "./matcher";
import { yinPitch } from "./yin";

function note(partial: Partial<LessonNote> & Pick<LessonNote, "id" | "midi" | "beat">): LessonNote {
  return {
    durationBeats: 1,
    hand: "right",
    finger: 1,
    ...partial,
  };
}

test("Wait advances only after a simulated hit", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 1 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "wait",
    now: () => t,
  });
  transport.start();

  let snap = transport.tick();
  assert.equal(snap.waiting, true);
  assert.equal(snap.states.a, "waiting");

  t = 2;
  snap = transport.tick();
  assert.equal(snap.timeSec, 0);
  assert.equal(snap.waiting, true);

  transport.reportDetected({ midi: 64, cents: 0, t });
  snap = transport.tick();
  assert.equal(snap.states.a, "waiting");
  assert.ok(snap.wrongFlashIds.includes("a"));

  transport.reportDetected({ midi: 60, cents: 10, t });
  snap = transport.tick();
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.waiting, false);

  t = 3;
  snap = transport.tick();
  assert.ok(snap.timeSec > 0);
  assert.equal(snap.states.b, "waiting");
});

test("reportDetected says what it did with the note", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 1 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "wait",
    now: () => t,
  });

  assert.equal(transport.reportDetected({ midi: 60, cents: 0, t }), "idle");
  transport.start();
  t = 2;
  transport.tick();
  assert.equal(transport.reportDetected({ midi: 64, cents: 0, t }), "wrong");
  assert.equal(transport.reportDetected({ midi: 60, cents: 0, t }), "hit");

  transport.setMode("listen");
  assert.equal(transport.reportDetected({ midi: 62, cents: 0, t }), "listen-mode");

  transport.setMode("play-along");
  assert.equal(transport.reportDetected({ midi: 62, cents: 0, t }), "not-due");
  t = 3;
  transport.tick();
  assert.equal(transport.reportDetected({ midi: 62, cents: 0, t }), "hit");
  assert.equal(transport.reportDetected({ midi: 62, cents: 0, t }), "lesson-done");
});

test("Play-along never pauses and misses after the late window", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "play-along",
    now: () => t,
    lateMs: 150,
  });
  transport.start();

  t = 0.05;
  let snap = transport.tick();
  assert.equal(snap.waiting, false);
  assert.equal(snap.states.a, "due");

  t = 0.4;
  snap = transport.tick();
  assert.equal(snap.waiting, false);
  assert.equal(snap.states.a, "missed");
});

test("Listen ignores the matcher and auto-hits on attack", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
  });
  transport.start();
  transport.reportDetected({ midi: 72, cents: 0, t: 0 });
  let snap = transport.tick();
  assert.equal(snap.states.a, "hit");
  t = 1;
  snap = transport.tick();
  assert.equal(snap.waiting, false);
  assert.equal(snap.states.a, "hit");
});

test("matcher accepts pitches inside the cents window", () => {
  assert.equal(isPitchHit(60, { midi: 60, cents: 40, t: 0 }, 50), true);
  assert.equal(isPitchHit(60, { midi: 62, cents: 0, t: 0 }, 50), false);
});

test("matcher counts the wrong octave as a wrong note", () => {
  assert.equal(isPitchHit(60, { midi: 72, cents: 10, t: 0 }, 50), false);
  assert.equal(isPitchHit(60, { midi: 48, cents: 0, t: 0 }, 50), false);
});

test("YIN estimates a 440Hz sine", () => {
  const sampleRate = 44100;
  const freq = 440;
  const buf = new Float32Array(2048);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  const result = yinPitch(buf, sampleRate);
  assert.ok(result);
  assert.ok(Math.abs(result.frequency - 440) < 2);
  const { midi } = frequencyToMidi(result.frequency);
  assert.equal(midi, 69);
});

test("Listen to wait pauses on the sounding note", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 2 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
  });
  transport.start();
  t = 0.4;
  let snap = transport.tick();
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.waiting, false);

  transport.setMode("wait");
  t = 1;
  snap = transport.tick();
  assert.equal(snap.states.a, "waiting");
  assert.equal(snap.waiting, true);
  assert.equal(snap.timeSec, 0);
  assert.equal(snap.states.b, "upcoming");
});

test("Wait to listen resumes autoplay from the current note", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 1 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "wait",
    now: () => t,
  });
  transport.start();
  let snap = transport.tick();
  assert.equal(snap.waiting, true);
  assert.equal(snap.states.a, "waiting");

  t = 2;
  snap = transport.tick();
  assert.equal(snap.timeSec, 0);

  transport.setMode("listen");
  snap = transport.tick();
  assert.equal(snap.waiting, false);
  assert.equal(snap.states.a, "hit");
  assert.deepEqual(snap.attacksThisTick, ["a"]);

  t = 3;
  snap = transport.tick();
  assert.ok(snap.timeSec > 0);
  assert.equal(snap.states.b, "hit");
});

test("Pause freezes listen playback until start resumes", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 2 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
  });
  transport.start();
  t = 0.5;
  let snap = transport.tick();
  assert.equal(snap.running, true);
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.states.b, "upcoming");

  transport.pause();
  snap = transport.tick();
  assert.equal(snap.running, false);
  const pausedAt = snap.timeSec;

  t = 3;
  snap = transport.tick();
  assert.equal(snap.running, false);
  assert.equal(snap.timeSec, pausedAt);
  assert.equal(snap.states.b, "upcoming");

  transport.start();
  t = 3.5;
  snap = transport.tick();
  assert.equal(snap.running, true);
  assert.ok(snap.timeSec > pausedAt);
  assert.equal(snap.states.b, "upcoming");

  t = 5;
  snap = transport.tick();
  assert.equal(snap.states.b, "hit");
});

test("lead-in delays beat 0 until the count-in elapses", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 1 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
    leadInSec: 2,
  });
  transport.start();
  let snap = transport.tick();
  assert.equal(snap.timeSec, -2);
  assert.equal(snap.states.a, "upcoming");
  assert.deepEqual(snap.attacksThisTick, []);

  t = 0.5;
  snap = transport.tick();
  assert.ok(snap.timeSec < 0);
  assert.equal(snap.states.a, "upcoming");
  assert.deepEqual(snap.attacksThisTick, []);

  t = 2;
  snap = transport.tick();
  assert.ok(Math.abs(snap.timeSec) < 1e-9);
  assert.equal(snap.states.a, "hit");
  assert.deepEqual(snap.attacksThisTick, ["a"]);

  t = 3;
  snap = transport.tick();
  assert.equal(snap.states.b, "hit");
});

test("play-along count-in hides after 1 for one beat before music", () => {
  const tempo = 120;
  const lead = playAlongLeadInSec(tempo);
  assert.equal(lead, 5.5);
  assert.equal(playAlongCountDigit(-lead, tempo), 5);
  assert.equal(playAlongCountDigit(-1.5, tempo), 1);
  assert.equal(playAlongCountDigit(-0.5, tempo), null);
  assert.equal(playAlongCountDigit(-0.01, tempo), null);
  assert.equal(playAlongCountDigit(0, tempo), null);
});

test("play-along lead-in does not miss the first note", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "play-along",
    now: () => t,
    leadInSec: 5,
    lateMs: 150,
  });
  transport.start();
  t = 1;
  let snap = transport.tick();
  assert.equal(snap.states.a, "upcoming");
  assert.equal(snap.waiting, false);

  t = 5.05;
  snap = transport.tick();
  assert.equal(snap.states.a, "due");
  assert.equal(snap.states.a === "missed", false);
});

test("setTempo keeps the current beat and changes speed", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 2 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
  });
  transport.start();
  t = 1;
  let snap = transport.tick();
  assert.equal(snap.beat, 1);
  assert.equal(snap.states.b, "upcoming");

  transport.setTempo(120);
  snap = transport.tick();
  assert.ok(Math.abs(snap.beat - 1) < 1e-9);
  assert.equal(snap.timeSec, 0.5);

  t = 1.5;
  snap = transport.tick();
  assert.ok(Math.abs(snap.beat - 2) < 1e-9);
  assert.equal(snap.states.b, "hit");
});

test("YIN estimates a C4 sine", () => {
  const sampleRate = 44100;
  const freq = 261.63;
  const buf = new Float32Array(4096);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  const result = yinPitch(buf, sampleRate, 0.2);
  assert.ok(result);
  const { midi } = frequencyToMidi(result.frequency);
  assert.equal(midi, 60);
});

test("seek jumps listen time and note states", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 4 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
  });
  transport.start();
  t = 0.2;
  let snap = transport.tick();
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.states.b, "upcoming");

  transport.seek(3.5);
  snap = transport.tick();
  assert.ok(Math.abs(snap.timeSec - 3.5) < 1e-9);
  assert.equal(snap.running, true);
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.states.b, "upcoming");
  assert.deepEqual(snap.attacksThisTick, []);

  t = 1.2;
  snap = transport.tick();
  assert.ok(Math.abs(snap.timeSec - 4.5) < 1e-9);
  assert.equal(snap.states.b, "hit");
});

test("seek while paused stays paused", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 2 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
  });
  transport.start();
  t = 0.4;
  transport.tick();
  transport.pause();
  transport.seek(1.5);
  t = 8;
  const snap = transport.tick();
  assert.equal(snap.running, false);
  assert.ok(Math.abs(snap.timeSec - 1.5) < 1e-9);
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.states.b, "upcoming");
});

test("seek in wait gates on the note at the playhead", () => {
  let t = 0;
  const notes = [
    note({ id: "a", midi: 60, beat: 0 }),
    note({ id: "b", midi: 62, beat: 2 }),
    note({ id: "c", midi: 64, beat: 4 }),
  ];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "wait",
    now: () => t,
  });
  transport.start();
  transport.tick();
  transport.seek(2.25);
  let snap = transport.tick();
  assert.ok(Math.abs(snap.timeSec - 2.25) < 1e-9);
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.states.b, "waiting");
  assert.equal(snap.states.c, "upcoming");
  assert.equal(snap.currentNoteId, "b");

  t = 5;
  snap = transport.tick();
  assert.ok(Math.abs(snap.timeSec - 2.25) < 1e-9);
  assert.equal(snap.waiting, true);
  assert.equal(snap.states.c, "upcoming");

  transport.reportDetected({ midi: 62, cents: 0, t });
  snap = transport.tick();
  assert.equal(snap.states.b, "hit");
});

test("restart returns to lead-in with upcoming notes", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 1 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "listen",
    now: () => t,
    leadInSec: 2,
  });
  transport.start();
  t = 3;
  let snap = transport.tick();
  assert.equal(snap.states.a, "hit");

  transport.restart();
  snap = transport.tick();
  assert.equal(snap.running, true);
  assert.ok(Math.abs(snap.timeSec + 2) < 1e-6);
  assert.equal(snap.states.a, "upcoming");
  assert.equal(snap.states.b, "upcoming");
  assert.equal(snap.complete, false);

  t = 5;
  snap = transport.tick();
  assert.ok(Math.abs(snap.timeSec) < 1e-6);
  assert.equal(snap.states.a, "hit");
});

test("Wait accepts the expected pitch during lead-in", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 }), note({ id: "b", midi: 62, beat: 1 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "wait",
    now: () => t,
    leadInSec: 2,
  });
  transport.start();
  let snap = transport.tick();
  assert.equal(snap.timeSec, -2);
  assert.equal(snap.states.a, "upcoming");
  assert.equal(snap.waiting, false);

  transport.reportDetected({ midi: 60, cents: 0, t: 0 });
  snap = transport.tick();
  assert.equal(snap.states.a, "hit");
  assert.equal(snap.waiting, false);
});

test("Wait ignores wrong pitches during lead-in", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "wait",
    now: () => t,
    leadInSec: 2,
  });
  transport.start();
  transport.tick();
  transport.reportDetected({ midi: 64, cents: 0, t: 0 });
  const snap = transport.tick();
  assert.equal(snap.states.a, "upcoming");
  assert.equal(snap.wrongFlashIds.length, 0);
});

test("each reported attack scores exactly once", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "wait",
    now: () => t,
  });
  transport.start();
  transport.tick();

  transport.reportDetected({ midi: 64, cents: 0, t });
  assert.equal(transport.stats().wrongs, 1);
  t = 0.5;
  transport.reportDetected({ midi: 64, cents: 0, t });
  assert.equal(transport.stats().wrongs, 2);

  transport.reportDetected({ midi: 60, cents: 0, t });
  assert.equal(transport.stats().hits, 1);
  assert.equal(transport.tick().states.a, "hit");
});
