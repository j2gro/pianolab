import assert from "node:assert/strict";
import { test } from "node:test";
import { createOnsetGate, newOnsetDiagnostics } from "./onset";

const FRAME_SEC = 1 / 60;

/** Piano-like level per frame: the analysis window fills over a few frames, then decays. */
function envelope(peak: number, frames: number, decayPerFrame = 0.97) {
  const out = [peak * 0.3, peak * 0.7, peak];
  let level = peak;
  while (out.length < frames) {
    level *= decayPerFrame;
    out.push(level);
  }
  return out.slice(0, frames);
}

function feed(gate: ReturnType<typeof createOnsetGate>, midi: number | null, levels: number[]) {
  const attacks: number[] = [];
  levels.forEach((rms, i) => {
    const attack = gate({ midi, cents: 0, rms, t: i * FRAME_SEC });
    if (attack) {
      attacks.push(attack.t);
    }
  });
  return attacks;
}

test("a held note reports one attack", () => {
  const gate = createOnsetGate();
  assert.deepEqual(feed(gate, 60, envelope(0.15, 90)), [0]);
});

test("a repeated note is found while the first one is still ringing", () => {
  const gate = createOnsetGate();
  const first = envelope(0.15, 60);
  const second = envelope(0.15, 27);
  const strikeAt = 33;
  const levels = first.map((level, i) =>
    Math.hypot(level, i >= strikeAt ? (second[i - strikeAt] ?? 0) : 0),
  );
  const attacks = feed(gate, 65, levels);
  assert.equal(attacks.length, 2);
  assert.ok(attacks[1]! - attacks[0]! > 0.4);
});

test("the attack ramp itself is not a second strike", () => {
  const gate = createOnsetGate();
  const slowAttack = [0.01, 0.02, 0.04, 0.07, 0.1, 0.13, 0.15, ...envelope(0.15, 40).slice(3)];
  assert.deepEqual(feed(gate, 65, slowAttack), [0]);
});

test("losing the pitch rearms the gate", () => {
  const gate = createOnsetGate();
  assert.ok(gate({ midi: 60, cents: 0, rms: 0.1, t: 0 }));
  assert.equal(gate({ midi: null, cents: null, rms: 0.0005, t: FRAME_SEC }), null);
  assert.ok(gate({ midi: 60, cents: 0, rms: 0.1, t: 2 * FRAME_SEC }));
});

test("diagnostics say what the gate did with each frame", () => {
  const gate = createOnsetGate();
  const first = newOnsetDiagnostics();
  gate({ midi: 60, cents: 0, rms: 0.1, t: 0 }, first);
  assert.equal(first.decision, "attack");
  assert.equal(first.held, null);

  const sustain = newOnsetDiagnostics();
  gate({ midi: 60, cents: 0, rms: 0.09, t: FRAME_SEC }, sustain);
  assert.equal(sustain.decision, "held");
  assert.equal(sustain.held, 60);

  const silence = newOnsetDiagnostics();
  gate({ midi: null, cents: null, rms: 0.0005, t: 2 * FRAME_SEC }, silence);
  assert.equal(silence.decision, "no-pitch");
});

test("diagnostics carry the level ratio behind a restrike", () => {
  const gate = createOnsetGate();
  const levels = [...envelope(0.15, 40), ...envelope(0.3, 20)];
  let restrike: ReturnType<typeof newOnsetDiagnostics> | null = null;
  levels.forEach((rms, i) => {
    const diag = newOnsetDiagnostics();
    gate({ midi: 65, cents: 0, rms, t: i * FRAME_SEC }, diag);
    if (diag.decision === "restrike") {
      restrike ??= diag;
    }
  });
  assert.ok(restrike, "expected a restrike");
  assert.ok(restrike!.rise! >= 1.4);
  assert.ok(restrike!.sinceLastOnset >= 0.2);
});

test("a new pitch attacks immediately", () => {
  const gate = createOnsetGate();
  assert.ok(gate({ midi: 60, cents: 0, rms: 0.1, t: 0 }));
  const attack = gate({ midi: 62, cents: -12, rms: 0.09, t: FRAME_SEC });
  assert.equal(attack?.midi, 62);
  assert.equal(attack?.cents, -12);
});
