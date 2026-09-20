import assert from "node:assert/strict";
import { test } from "node:test";
import type { LessonNote } from "@pianolab/lesson-schema";
import { isPitchHit } from "./matcher";
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
    stableMs: 0,
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

test("Play-along never pauses and misses after the late window", () => {
  let t = 0;
  const notes = [note({ id: "a", midi: 60, beat: 0 })];
  const transport = createTransport({
    notes,
    tempo: 60,
    mode: "play-along",
    now: () => t,
    stableMs: 0,
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
    stableMs: 0,
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
  assert.equal(isPitchHit(60, { midi: 72, cents: 10, t: 0 }, 50), true);
  assert.equal(isPitchHit(60, { midi: 48, cents: 0, t: 0 }, 50), true);
  assert.equal(isPitchHit(60, { midi: 62, cents: 0, t: 0 }, 50), false);
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
    stableMs: 0,
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
    stableMs: 0,
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
