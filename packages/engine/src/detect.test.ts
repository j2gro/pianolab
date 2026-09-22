import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAdaptiveGate,
  detectHeardPitch,
  newPitchDiagnostics,
  PITCH_HARMONIC_CONTRAST_MIN,
  PITCH_RMS_MIN,
  PITCH_TONE_MIN,
} from "./detect";
import { isPitchHit, midiToFrequency } from "./matcher";

function sine(freq: number, n: number, sr: number, amp: number) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return buf;
}

function partials(f0: number, amps: number[], n: number, sr: number, scale = 0.15) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let h = 0; h < amps.length; h++) {
      s += amps[h]! * Math.sin((2 * Math.PI * f0 * (h + 1) * i) / sr + h);
    }
    buf[i] = s * scale;
  }
  return buf;
}

const A2 = midiToFrequency(45);
const C4 = midiToFrequency(60);
const C5 = midiToFrequency(72);
const D3 = midiToFrequency(50);
const E4 = midiToFrequency(64);
const FS3 = midiToFrequency(54);
const F4 = midiToFrequency(65);
const G5 = midiToFrequency(79);
const PIANO = [0.25, 1, 0.7, 0.45, 0.3, 0.2];

function piano(f0: number, sr: number) {
  return partials(f0, PIANO, 4096, sr);
}

/** Weak fundamental and weak odd partials: YIN dips at half the period and calls it the octave up. */
function weakFundamental(f0: number, sr: number) {
  return partials(f0, [0.06, 1, 0.12, 0.6, 0.1, 0.3], 4096, sr);
}

function mix(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i]! + b[i]!;
  }
  return out;
}

test("detectHeardPitch reads a quiet C4 sine above the RMS floor", () => {
  const sr = 48000;
  const heard = detectHeardPitch(sine(C4, 4096, sr, 0.004), sr);
  assert.ok(heard.rms > PITCH_RMS_MIN);
  assert.equal(heard.midi, 60);
});

test("detectHeardPitch ignores below the RMS floor", () => {
  const sr = 48000;
  const heard = detectHeardPitch(sine(C4, 4096, sr, 0.0002), sr);
  assert.ok(heard.rms < PITCH_RMS_MIN);
  assert.equal(heard.midi, null);
});

test("detectHeardPitch reads a piano-like C4 at its own fundamental", () => {
  const sr = 44100;
  assert.equal(detectHeardPitch(piano(C4, sr), sr).midi, 60);
});

test("a played note is never reported an octave low", () => {
  const sr = 48000;
  for (const midi of [60, 62, 64, 65, 67, 69, 72]) {
    const hz = midiToFrequency(midi);
    assert.equal(detectHeardPitch(piano(hz, sr), sr).midi, midi, `free play ${midi}`);
    assert.equal(detectHeardPitch(piano(hz, sr), sr, midi).midi, midi, `expected ${midi}`);
  }
});

test("a sympathetic octave below the played note does not pull the reading down", () => {
  const sr = 48000;
  // E4 played, with the E3 strings ringing well below it.
  const buf = mix(piano(E4, sr), partials(midiToFrequency(52), [0.04, 0.02, 0.01], 4096, sr));
  assert.equal(detectHeardPitch(buf, sr).midi, 64);
  assert.equal(detectHeardPitch(buf, sr, 64).midi, 64);
});

test("expected C4 is still found when YIN locks onto the octave up", () => {
  const sr = 48000;
  const buf = weakFundamental(C4, sr);
  assert.equal(detectHeardPitch(buf, sr, 60).midi, 60);
  // Without an expected note there is nothing to resolve the octave against.
  assert.equal(detectHeardPitch(buf, sr).midi, 72);
});

test("a note struck under a louder ringing neighbour is found", () => {
  const sr = 48000;
  // Twinkle goes F4 F4 E4 E4, so E4 is always struck while F4 is still ringing.
  for (const ring of [0.5, 0.8, 1, 1.5, 2, 3]) {
    const buf = mix(partials(E4, PIANO, 4096, sr, 0.1), partials(F4, PIANO, 4096, sr, 0.1 * ring));
    assert.equal(detectHeardPitch(buf, sr, 64).midi, 64, `F4 ringing at ${ring}x E4`);
  }
});

test("a ringing neighbour on its own is not heard as the expected note", () => {
  const sr = 48000;
  for (const amp of [0.05, 0.1, 0.2]) {
    const heard = detectHeardPitch(partials(F4, PIANO, 4096, sr, amp), sr, 64);
    assert.equal(heard.midi, 65, `F4 at ${amp}`);
  }
});

test("a ringing A2 is not heard as the Canon notes that follow it", () => {
  const sr = 48000;
  const buf = piano(A2, sr);
  for (const midi of [49, 52, 57, 47]) {
    const heard = detectHeardPitch(buf, sr, midi, undefined, 45);
    assert.notEqual(heard.midi, midi, `A2 must not score as ${midi}`);
  }
});

test("an even-heavy decaying A2 is not heard as C#3 E3 or A3", () => {
  const sr = 48000;
  // Real A2 at 25.11s: 3rd almost gone, 6th strongest. 650ms later C#3
  // confirmed from 138Hz leakage (0.020) plus two bins at 0.002.
  const ring = partials(A2, [0.25, 0.45, 0.02, 0.09, 0.16, 2], 4096, sr, 0.06);
  const leaked = mix(ring, sine(midiToFrequency(49), 4096, sr, 0.02));
  for (const buf of [ring, leaked]) {
    for (const midi of [49, 52, 57, 47]) {
      const heard = detectHeardPitch(buf, sr, midi, undefined, 45);
      assert.notEqual(heard.midi, midi, `decaying A2 must not score as ${midi}`);
    }
  }
});

test("A2's octave is not snapped to as the following A3", () => {
  const sr = 48000;
  const buf = mix(sine(A2, 4096, sr, 0.06), sine(A2 * 2, 4096, sr, 0.2));
  const heard = detectHeardPitch(buf, sr, 57, undefined, 45);
  assert.notEqual(heard.midi, 57);
});

test("expected F#3 is still found while D3 is ringing", () => {
  const sr = 48000;
  const buf = mix(
    partials(FS3, [0.05, 1, 0.7, 0.1, 0.35, 0.08], 4096, sr, 0.08),
    partials(D3, PIANO, 4096, sr, 0.04),
  );
  assert.equal(detectHeardPitch(buf, sr, 54, undefined, 50).midi, 54);
});

test("expected F#3 is found when YIN is still locked on the previous D3", () => {
  const sr = 48000;
  const buf = mix(
    partials(FS3, [0.05, 1, 0.7, 0.1, 0.35, 0.08], 4096, sr, 0.06),
    partials(D3, PIANO, 4096, sr, 0.12),
  );
  const diag = newPitchDiagnostics();
  const heard = detectHeardPitch(buf, sr, 54, diag, 50);
  assert.equal(heard.midi, 54);
  assert.notEqual(heard.path, "reading");
});

test("expected F#3 is found when its fundamental is weak", () => {
  const sr = 48000;
  // Canon's F#3: energy in the 2nd/3rd, fund under PITCH_TONE_MIN. A little
  // noise keeps YIN from snapping, the way the real attacks had no period.
  const buf = mix(
    partials(FS3, [0.05, 1, 0.7, 0.1, 0.35, 0.08], 4096, sr, 0.0015),
    seededNoise(4096, 0.004, 7),
  );
  const diag = newPitchDiagnostics();
  const heard = detectHeardPitch(buf, sr, 54, diag);
  assert.equal(heard.midi, 54);
  assert.ok(heard.path === "partials" || heard.path === "partials-alone", heard.path);
  const fund = diag.probes.find((probe) => probe.partial === 1);
  assert.ok(fund && fund.strength < PITCH_TONE_MIN);
  const kept = applyAdaptiveGate(heard, Math.max(0.002, heard.rms * 2));
  assert.equal(kept.midi, 54);
});

test("a note that shares upper partials is not heard as the expected note", () => {
  const sr = 48000;
  // A3's 3rd and 6th partials land on E4's 2nd and 4th.
  const heard = detectHeardPitch(partials(midiToFrequency(57), PIANO, 4096, sr), sr, 64);
  assert.equal(heard.midi, 57);
});

test("expected C4 does not steal an isolated partial of C4", () => {
  const sr = 48000;
  for (const [freq, midi] of [
    [C5, 72],
    [G5, 79],
  ] as const) {
    const heard = detectHeardPitch(sine(freq, 4096, sr, 0.2), sr, 60);
    assert.equal(heard.midi, midi);
    assert.equal(isPitchHit(60, { midi: heard.midi!, cents: heard.cents ?? 0, t: 0 }, 60), false);
  }
});

test("an expected note two octaves down does not steal a played C4", () => {
  const sr = 48000;
  assert.equal(detectHeardPitch(piano(C4, sr), sr, 36).midi, 60);
});

test("expected C4 does not steal a G4 sine", () => {
  const sr = 48000;
  assert.equal(detectHeardPitch(sine(392.0, 4096, sr, 0.2), sr, 60).midi, 67);
});

function seededNoise(n: number, amp: number, seed = 1) {
  const buf = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    buf[i] = ((s / 0xffffffff) * 2 - 1) * amp;
  }
  return buf;
}

/** Brief decaying impact in an otherwise quiet analysis window. */
function shortClick(n: number, sr: number, amp: number, seed = 3) {
  const buf = new Float32Array(n);
  let s = seed >>> 0;
  const len = Math.floor(sr * 0.004);
  for (let i = 0; i < len; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    const env = Math.exp(-i / (sr * 0.0012));
    buf[i] = amp * env * ((s / 0xffffffff) * 2 - 1);
  }
  return buf;
}

/** Desk-like modes: a few decaying sines plus a click, not a harmonic series. */
function deskRing(n: number, sr: number, modes: number[], amp: number, seed = 4) {
  const buf = shortClick(n, sr, amp * 0.4, seed);
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-i / (sr * 0.04));
    for (const hz of modes) {
      buf[i] += amp * env * Math.sin((2 * Math.PI * hz * i) / sr);
    }
  }
  return buf;
}

test("diagnostics name the path that reported the note", () => {
  const sr = 48000;
  const straight = newPitchDiagnostics();
  detectHeardPitch(piano(C4, sr), sr, 60, straight);
  assert.equal(straight.path, "snap");
  assert.ok(straight.yinHz! > 0);

  const masked = newPitchDiagnostics();
  detectHeardPitch(mix(piano(E4, sr), partials(F4, PIANO, 4096, sr, 0.3)), sr, 64, masked);
  assert.ok(masked.path === "partials" || masked.path === "partials-alone", masked.path);

  const noExpectation = newPitchDiagnostics();
  detectHeardPitch(piano(C4, sr), sr, null, noExpectation);
  assert.equal(noExpectation.path, "reading");
  assert.equal(noExpectation.expectedHz, null);
});

test("diagnostics carry the partial strengths the decision was made on", () => {
  const sr = 48000;
  const diag = newPitchDiagnostics();
  detectHeardPitch(partials(F4, PIANO, 4096, sr, 0.1), sr, 64, diag);
  // A ringing F4 alone, so the probes are the evidence E4 was rejected on.
  assert.equal(diag.expectedHz, E4);
  assert.ok(diag.probes.length >= 4);
  assert.deepEqual(
    diag.probes.map((probe) => probe.partial),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(diag.probes.every((probe) => probe.hz > 0 && probe.strength >= 0));
  assert.ok(
    diag.probes.filter((probe) => !probe.unresolvable && probe.strength >= PITCH_TONE_MIN).length <
      2,
  );
});

test("diagnostics report a frame under the floor without probing", () => {
  const sr = 48000;
  const diag = newPitchDiagnostics();
  detectHeardPitch(sine(C4, 4096, sr, 0.0002), sr, 60, diag);
  assert.equal(diag.path, "below-floor");
  assert.equal(diag.probes.length, 0);
  assert.equal(diag.contrast, null);
});

test("a quiet expected E4 is kept through the adaptive gate", () => {
  const sr = 48000;
  const heard = detectHeardPitch(partials(E4, PIANO, 4096, sr, 0.0015), sr, 64);
  assert.equal(heard.midi, 64);
  assert.ok(heard.rms < 0.002, `rms ${heard.rms}`);
  assert.ok(heard.rms > PITCH_RMS_MIN);
  const kept = applyAdaptiveGate(heard, 0.002);
  assert.equal(kept.midi, 64);
  assert.notEqual(kept.path, "gated");
});

test("a raw reading under the gate is still dropped", () => {
  const sr = 48000;
  const heard = detectHeardPitch(sine(C4, 4096, sr, 0.004), sr);
  assert.equal(heard.midi, 60);
  const dropped = applyAdaptiveGate({ ...heard, rms: 0.0012 }, 0.002);
  assert.equal(dropped.midi, null);
  assert.equal(dropped.path, "gated");
});

test("70Hz rumble does not hide an expected E4", () => {
  const sr = 48000;
  const buf = mix(piano(E4, sr), sine(70, 4096, sr, 0.15));
  const diag = newPitchDiagnostics();
  const heard = detectHeardPitch(buf, sr, 64, diag);
  assert.equal(heard.midi, 64);
  assert.ok(
    diag.probes.filter((probe) => !probe.unresolvable && probe.strength >= PITCH_TONE_MIN).length >=
      2,
  );
});

test("70Hz rumble alone is not heard as E4 or as a low note", () => {
  const sr = 48000;
  const heard = detectHeardPitch(sine(70, 4096, sr, 0.2), sr, 64);
  assert.equal(heard.midi, null);
});

test("a neighbouring semitone YIN reading does not hide E4's fundamental", () => {
  const sr = 48000;
  // YIN leans to F4; the 35Hz bin cut used to mark E4's fund unresolvable.
  const buf = mix(partials(E4, PIANO, 4096, sr, 0.1), partials(F4, PIANO, 4096, sr, 0.15));
  const diag = newPitchDiagnostics();
  const heard = detectHeardPitch(buf, sr, 64, diag);
  assert.equal(heard.midi, 64);
  const fund = diag.probes.find((probe) => probe.partial === 1);
  assert.ok(fund);
  assert.equal(fund!.unresolvable, false);
  assert.ok(fund!.strength >= PITCH_TONE_MIN);
});

test("background noise is not heard as the expected C4", () => {
  const sr = 48000;
  for (let seed = 1; seed <= 8; seed++) {
    const heard = detectHeardPitch(seededNoise(4096, 0.02, seed), sr, 60);
    if (heard.midi === null) {
      continue;
    }
    assert.equal(isPitchHit(60, { midi: heard.midi, cents: heard.cents ?? 0, t: 0 }, 60), false);
  }
});

test("desk resonance is not heard as the waiting Canon notes", () => {
  const sr = 48000;
  // 110/165/220 lights A2's fund and 2nd, which used to confirm A2 with no YIN.
  const buf = deskRing(4096, sr, [110, 165, 220], 0.05, 4);
  for (const midi of [45, 50, 54, 57, 62, 64]) {
    const heard = detectHeardPitch(buf, sr, midi);
    assert.notEqual(heard.midi, midi, `desk must not score as ${midi}`);
  }
});

test("a mouse-thump click is not heard as the expected note", () => {
  const sr = 48000;
  for (const seed of [1, 3, 7, 11]) {
    const buf = shortClick(4096, sr, 0.8, seed);
    for (const midi of [45, 50, 54, 60, 64]) {
      const heard = detectHeardPitch(buf, sr, midi);
      assert.notEqual(heard.midi, midi, `click seed ${seed} must not score as ${midi}`);
    }
  }
});

test("a confirmed piano note reports harmonic contrast well above the floor", () => {
  const sr = 48000;
  const diag = newPitchDiagnostics();
  const heard = detectHeardPitch(
    mix(partials(FS3, [0.05, 1, 0.7, 0.1, 0.35, 0.08], 4096, sr, 0.0015), seededNoise(4096, 0.004, 7)),
    sr,
    54,
    diag,
  );
  assert.equal(heard.midi, 54);
  assert.ok(
    diag.contrast !== null && diag.contrast >= PITCH_HARMONIC_CONTRAST_MIN,
    `${diag.contrast}`,
  );
});
