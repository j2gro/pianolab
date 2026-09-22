import type { DetectedNote } from "./types";

/** How much louder a fresh strike is than the level one lookback ago. */
export const RESTRIKE_RISE_RATIO = 1.4;
/** A strike is measured against the level this far back, long enough to span the attack. */
export const RESTRIKE_LOOKBACK_SEC = 0.1;
/**
 * Shortest gap between two attacks on one pitch. Long enough that the analysis
 * window filling up after a strike is not read as a second strike.
 */
export const RESTRIKE_REFRACTORY_SEC = 0.2;

export type PitchFrame = {
  midi: number | null;
  cents: number | null;
  rms: number;
  t: number;
};

/** What the gate did with a frame. Filled in only when a caller asks for it. */
export type OnsetDiagnostics = {
  decision: "no-pitch" | "attack" | "restrike" | "held";
  /** The note the gate was already holding when the frame arrived. */
  held: number | null;
  /** Level now against the level one lookback ago, or null with no history yet. */
  rise: number | null;
  sinceLastOnset: number;
};

export function newOnsetDiagnostics(): OnsetDiagnostics {
  return { decision: "no-pitch", held: null, rise: null, sinceLastOnset: Infinity };
}

/**
 * Turns per-frame pitch readings into one attack per strike, the way the
 * keyboard adapter reports one event per keydown. Without it a held note is
 * reported ~60 times a second and two identical notes in a row share one press.
 *
 * A repeated note is found by its attack rather than by waiting for the first
 * one to decay, because on a piano the first note is still ringing well into the
 * second.
 */
export function createOnsetGate(): (
  frame: PitchFrame,
  diag?: OnsetDiagnostics,
) => DetectedNote | null {
  let held: number | null = null;
  let lastOnset = -Infinity;
  const levels: { t: number; rms: number }[] = [];

  return (frame, diag) => {
    levels.push({ t: frame.t, rms: frame.rms });
    let past = 0;
    while (levels.length > 1 && levels[1]!.t <= frame.t - RESTRIKE_LOOKBACK_SEC) {
      levels.shift();
    }
    if (levels[0]!.t <= frame.t - RESTRIKE_LOOKBACK_SEC) {
      past = levels[0]!.rms;
    }
    if (diag) {
      diag.held = held;
      diag.rise = past > 0 ? frame.rms / past : null;
      diag.sinceLastOnset = frame.t - lastOnset;
    }

    const heard = frame.midi;
    if (heard === null) {
      held = null;
      return null;
    }
    const restrike =
      past > 0 &&
      frame.rms >= past * RESTRIKE_RISE_RATIO &&
      frame.t - lastOnset >= RESTRIKE_REFRACTORY_SEC;
    if (heard !== held || restrike) {
      if (diag) {
        diag.decision = heard !== held ? "attack" : "restrike";
      }
      held = heard;
      lastOnset = frame.t;
      return { midi: heard, cents: frame.cents ?? 0, t: frame.t };
    }
    if (diag) {
      diag.decision = "held";
    }
    return null;
  };
}
