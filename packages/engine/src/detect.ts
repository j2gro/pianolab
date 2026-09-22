import { frequencyToMidi, midiToFrequency } from "./matcher";
import { rms, toneStrengthAt, yinPitch } from "./yin";

export const PITCH_RMS_MIN = 0.001;
export const PITCH_YIN_THRESHOLD = 0.15;
export const PITCH_MIN_PROBABILITY = 0.7;
/** Share of the buffer's power a partial has to hold to count as present. */
export const PITCH_TONE_MIN = 0.002;
/** Partials that must be present to report a note alongside a detected pitch. */
export const PITCH_PARTIALS_REQUIRED = 2;
/** Partials that must be present to report a note with no detected pitch to lean on. */
export const PITCH_PARTIALS_REQUIRED_ALONE = 3;
/** How far off the expected note a reading can be and still be reported as that note. */
export const PITCH_EXPECTED_CENTS = 60;
/**
 * Expected partials have to out-peak the bins halfway between them by this
 * factor. Piano does so by 70× or more; desk thumps and broadband noise sit
 * near 1–3 and would otherwise confirm whatever note the lesson is waiting on.
 */
export const PITCH_HARMONIC_CONTRAST_MIN = 4;
/**
 * A YIN reading below this, when a note is expected, is treated as no period.
 * The 70Hz highpass and YIN_MIN_HZ both sit here; room rumble locks onto it
 * and would otherwise veto every partial of a mid-range note.
 */
export const PITCH_YIN_TRUST_MIN_HZ = 100;

/** Highest partial YIN is expected to mistake for a fundamental. */
const MAX_PARTIAL = 6;

export type PitchPath =
  | "below-floor"
  | "gated"
  | "no-pitch"
  | "snap"
  | "partials"
  | "partials-alone"
  | "reading";

export type HeardPitch = {
  rms: number;
  midi: number | null;
  cents: number | null;
  path: PitchPath;
};

/** The expected note's own probes already said it is there. */
export function isConfirmedExpected(path: PitchPath): boolean {
  return path === "snap" || path === "partials" || path === "partials-alone";
}

/**
 * Broadband RMS gate. A quiet E4 can sit under `noiseRms * 4` while its
 * partials are obviously present, so a confirmed expected note is kept.
 */
export function applyAdaptiveGate(heard: HeardPitch, gate: number): HeardPitch {
  if (heard.rms >= gate || isConfirmedExpected(heard.path)) {
    return heard;
  }
  return { rms: heard.rms, midi: null, cents: null, path: "gated" };
}

export type PitchProbe = {
  partial: number;
  hz: number;
  strength: number;
  /** Too close to a partial of the detected pitch for this window to tell apart. */
  unresolvable: boolean;
};

/** Why the detector reported what it did. Filled in only when a caller asks for it. */
export type PitchDiagnostics = {
  path: PitchPath;
  yinHz: number | null;
  yinProbability: number | null;
  expectedHz: number | null;
  /** Peak expected partial over peak half-harmonic bin, when that was measured. */
  contrast: number | null;
  probes: PitchProbe[];
};

export function newPitchDiagnostics(): PitchDiagnostics {
  return {
    path: "below-floor",
    yinHz: null,
    yinProbability: null,
    expectedHz: null,
    contrast: null,
    probes: [],
  };
}

let hannTable: Float32Array | null = null;
let hannScratch: Float32Array | null = null;

/** Windowed copy, so probing one frequency does not pick up leakage from a loud neighbour. */
function windowed(buf: Float32Array): Float32Array {
  const n = buf.length;
  if (!hannTable || hannTable.length !== n) {
    hannTable = new Float32Array(n);
    hannScratch = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      hannTable[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
  }
  const probe = hannScratch!;
  for (let i = 0; i < n; i++) {
    probe[i] = buf[i]! * hannTable[i]!;
  }
  return probe;
}

function centsBetween(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference);
}

function nearPartialOf(hz: number, fundamentalHz: number): boolean {
  const n = Math.max(1, Math.round(hz / fundamentalHz));
  return Math.abs(centsBetween(hz, fundamentalHz * n)) <= PITCH_EXPECTED_CENTS;
}

/**
 * Counts how many of a note's own partials carry real power. A partial is
 * skipped only when it is within the snap window of a partial of `detectedHz`.
 * A 3-bin (35Hz) cut was wider than a semitone at E4, so F4 or a 70Hz rumble
 * hid the evidence the presence test needed.
 */
function partialsPresent(
  probe: Float32Array,
  sampleRate: number,
  fundamentalHz: number,
  detectedHz: number | null,
  diag?: PitchDiagnostics,
): { present: number; fundamental: boolean; peak: number } {
  let present = 0;
  let fundamental = false;
  let peak = 0;
  for (let n = 1; n <= MAX_PARTIAL; n++) {
    const hz = fundamentalHz * n;
    if (hz >= sampleRate / 2) {
      break;
    }
    const unresolvable = detectedHz !== null && nearPartialOf(hz, detectedHz);
    const strength = toneStrengthAt(probe, sampleRate, hz);
    diag?.probes.push({ partial: n, hz, strength, unresolvable });
    peak = Math.max(peak, strength);
    if (unresolvable) {
      continue;
    }
    if (strength >= PITCH_TONE_MIN) {
      present += 1;
      fundamental = fundamental || n === 1;
    }
  }
  return { present, fundamental, peak };
}

/**
 * Piano energy piles up on n*f0 and leaves the half-harmonic bins empty.
 * A desk thump or mouse bounce lights both, so the ratio stays near 1.
 */
function harmonicContrast(
  probe: Float32Array,
  sampleRate: number,
  fundamentalHz: number,
): number {
  let onPeak = 0;
  let offPeak = 0;
  for (let n = 1; n <= MAX_PARTIAL; n++) {
    const onHz = fundamentalHz * n;
    const offHz = fundamentalHz * (n + 0.5);
    if (onHz < sampleRate / 2) {
      onPeak = Math.max(onPeak, toneStrengthAt(probe, sampleRate, onHz));
    }
    if (offHz < sampleRate / 2) {
      offPeak = Math.max(offPeak, toneStrengthAt(probe, sampleRate, offHz));
    }
  }
  if (offPeak <= 1e-12) {
    return onPeak > 0 ? 1e6 : 0;
  }
  return onPeak / offPeak;
}

function hasHarmonicShape(
  probe: Float32Array,
  sampleRate: number,
  expectedHz: number,
  diag?: PitchDiagnostics,
): boolean {
  const contrast = harmonicContrast(probe, sampleRate, expectedHz);
  if (diag) {
    diag.contrast = contrast;
  }
  return contrast >= PITCH_HARMONIC_CONTRAST_MIN;
}

/** Whether the expected note is sounding as well as, or instead of, the detected pitch. */
function expectedIsSounding(
  probe: Float32Array,
  sampleRate: number,
  expectedHz: number,
  detectedHz: number,
  diag?: PitchDiagnostics,
): boolean {
  const { present } = partialsPresent(probe, sampleRate, expectedHz, detectedHz, diag);
  return present >= PITCH_PARTIALS_REQUIRED && hasHarmonicShape(probe, sampleRate, expectedHz, diag);
}

/**
 * Partials of `expectedHz` that are not on `otherHz`'s harmonic series.
 * A2's 2nd/3rd/4th are A3/E4/A4; counting those as a new note is how
 * one ringing bass note walks the lesson forward.
 */
/** Strongest unexpected partial has to clear this, so A2 leakage into B2 (≈0.0026) does not count. */
const UNEXPLAINED_PEAK_MIN = 0.004;
/**
 * Two bins just over 0.002 is how A2 leakage at 138Hz plus two neighbours
 * scored C#3. A real new note puts at least two of its own partials up here.
 */
const UNEXPLAINED_STRONG_MIN = 0.008;

function unexplainedEvidence(
  probe: Float32Array,
  sampleRate: number,
  expectedHz: number,
  otherHz: number,
): { count: number; strong: number; peak: number } {
  let count = 0;
  let strong = 0;
  let peak = 0;
  for (let n = 1; n <= MAX_PARTIAL; n++) {
    const hz = expectedHz * n;
    if (hz >= sampleRate / 2) {
      break;
    }
    const strength = toneStrengthAt(probe, sampleRate, hz);
    if (strength < PITCH_TONE_MIN || nearPartialOf(hz, otherHz)) {
      continue;
    }
    count += 1;
    if (strength >= UNEXPLAINED_STRONG_MIN) {
      strong += 1;
    }
    peak = Math.max(peak, strength);
  }
  return { count, strong, peak };
}

function hasOwnNoteAgainstPrevious(
  probe: Float32Array,
  sampleRate: number,
  expectedHz: number,
  previousHz: number,
): boolean {
  const { strong, peak } = unexplainedEvidence(probe, sampleRate, expectedHz, previousHz);
  return strong >= PITCH_PARTIALS_REQUIRED && peak >= UNEXPLAINED_PEAK_MIN;
}

function previousStillSounding(
  probe: Float32Array,
  sampleRate: number,
  previousHz: number,
): boolean {
  const { present, fundamental, peak } = partialsPresent(probe, sampleRate, previousHz, null);
  return fundamental || present >= PITCH_PARTIALS_REQUIRED || peak >= UNEXPLAINED_PEAK_MIN;
}

/**
 * Whether the expected note is sounding when YIN found no period. A piano
 * F#3 often has a weak fundamental and strong 2nd/3rd; three of its own
 * partials are enough when nothing else is ringing. Those bins also have
 * to look like a harmonic series, or a desk thump confirms whatever the
 * lesson is waiting on. If the previous note is still there, the partials
 * have to be ones it does not explain — otherwise A2's overtones score
 * C#3, E3, A3, and B2 in one buffer.
 */
function expectedIsSoundingAlone(
  probe: Float32Array,
  sampleRate: number,
  expectedHz: number,
  previousHz: number | null,
  diag?: PitchDiagnostics,
): boolean {
  const { present, fundamental } = partialsPresent(probe, sampleRate, expectedHz, null, diag);
  const alone =
    (fundamental && present >= PITCH_PARTIALS_REQUIRED) ||
    present >= PITCH_PARTIALS_REQUIRED_ALONE;
  if (!alone || !hasHarmonicShape(probe, sampleRate, expectedHz, diag)) {
    return false;
  }
  if (previousHz === null || !previousStillSounding(probe, sampleRate, previousHz)) {
    return true;
  }
  return hasOwnNoteAgainstPrevious(probe, sampleRate, expectedHz, previousHz);
}

/**
 * `diag`, when given, is filled in with the reasoning behind the reading. It
 * costs a probe of every partial the fast paths would have skipped, so pass it
 * only when something is listening.
 */
export function detectHeardPitch(
  buf: Float32Array,
  sampleRate: number,
  expectedMidi?: number | null,
  diag?: PitchDiagnostics,
  previousMidi?: number | null,
): HeardPitch {
  const level = rms(buf);
  if (level < PITCH_RMS_MIN) {
    return finish({ rms: level, midi: null, cents: null, path: "below-floor" }, diag);
  }
  const pitch = yinPitch(buf, sampleRate, PITCH_YIN_THRESHOLD);
  const raw = pitch && pitch.probability >= PITCH_MIN_PROBABILITY ? pitch : null;
  if (diag) {
    diag.yinHz = pitch?.frequency ?? null;
    diag.yinProbability = pitch?.probability ?? null;
  }

  if (expectedMidi != null) {
    const expectedHz = midiToFrequency(expectedMidi);
    if (diag) {
      diag.expectedHz = expectedHz;
    }
    const previousHz =
      previousMidi != null && previousMidi !== expectedMidi ? midiToFrequency(previousMidi) : null;
    // Rumble at the YIN floor is not a pitch. A lock on the previous note is
    // not one either: after D3 scores, YIN stays on 147Hz and would otherwise
    // report D3 again instead of looking for F#3.
    let found = raw && raw.frequency >= PITCH_YIN_TRUST_MIN_HZ ? raw : null;
    if (
      found &&
      previousHz !== null &&
      Math.abs(centsBetween(found.frequency, previousHz)) <= PITCH_EXPECTED_CENTS
    ) {
      found = null;
    }
    // YIN reports one pitch and leans towards the higher of two sounding at
    // once, so a note struck under a still-ringing neighbour never surfaces:
    // Twinkle's F4 rings into E4 a semitone below. Look for the expected note's
    // own partials rather than trusting that single pitch.
    const probe = windowed(buf);
    if (found) {
      const cents = centsBetween(found.frequency, expectedHz);
      if (Math.abs(cents) <= PITCH_EXPECTED_CENTS) {
        // A2's octave is 220Hz. Snapping to A3 without asking whether A2 is
        // still the source is how decay walks the next Canon notes.
        const ownNote =
          previousHz === null ||
          !previousStillSounding(probe, sampleRate, previousHz) ||
          hasOwnNoteAgainstPrevious(probe, sampleRate, expectedHz, previousHz);
        if (ownNote) {
          return finish({ rms: level, midi: expectedMidi, cents, path: "snap" }, diag);
        }
        found = null;
      }
    }
    const sounding = found
      ? expectedIsSounding(probe, sampleRate, expectedHz, found.frequency, diag) &&
        (previousHz === null ||
          !previousStillSounding(probe, sampleRate, previousHz) ||
          hasOwnNoteAgainstPrevious(probe, sampleRate, expectedHz, previousHz))
      : expectedIsSoundingAlone(probe, sampleRate, expectedHz, previousHz, diag);
    if (sounding) {
      return finish(
        {
          rms: level,
          midi: expectedMidi,
          cents: 0,
          path: found ? "partials" : "partials-alone",
        },
        diag,
      );
    }
    if (!found) {
      return finish({ rms: level, midi: null, cents: null, path: "no-pitch" }, diag);
    }
    const heard = frequencyToMidi(found.frequency);
    return finish({ rms: level, midi: heard.midi, cents: heard.cents, path: "reading" }, diag);
  }

  if (!raw) {
    return finish({ rms: level, midi: null, cents: null, path: "no-pitch" }, diag);
  }
  const heard = frequencyToMidi(raw.frequency);
  return finish({ rms: level, midi: heard.midi, cents: heard.cents, path: "reading" }, diag);
}

function finish(heard: HeardPitch, diag?: PitchDiagnostics): HeardPitch {
  if (diag) {
    diag.path = heard.path;
  }
  return heard;
}
