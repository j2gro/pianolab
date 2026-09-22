import type {
  DetectionVerdict,
  NoteVisualState,
  OnsetDiagnostics,
  PitchDiagnostics,
} from "@pianolab/engine";

/** What the score was asking for when a frame was heard. */
export type MicContext = {
  timeSec: number;
  waiting: boolean;
  expectedId: string | null;
  expectedMidi: number | null;
  expectedState: NoteVisualState | null;
  /** Seconds since the expected note was due; negative means it is not due yet. */
  sinceExpectedDue: number | null;
  previousMidi: number | null;
  /** Seconds since the note before it was due. */
  sincePreviousDue: number | null;
  /** Notes the score has sounding right now, as an offset from their attack. */
  sounding: { midi: number; sinceAttack: number }[];
};

export type MicEvent = {
  seq: number;
  /** Seconds since the session started. */
  at: number;
  /** Audio clock time of the frame, which is what the transport scores against. */
  t: number;
  source: "mic" | "keys";
  rms: number;
  noiseFloor: number;
  gate: number;
  midi: number | null;
  cents: number | null;
  /** Set when the onset gate passed this frame on as a strike. */
  attack: boolean;
  verdict: DetectionVerdict | null;
  pitch: PitchDiagnostics | null;
  onset: OnsetDiagnostics | null;
  context: MicContext;
};

/** How the mic was opened, which decides what the detector is even given. */
export type MicSetup = {
  sampleRate: number;
  fftSize: number;
  /** Which getUserMedia constraint set the browser accepted. 0 is the strictest. */
  constraintAttempt: number;
  track: MediaTrackSettings | null;
};

export type MicSession = {
  startedAt: string;
  lesson: string;
  phrase: string;
  mode: string;
  tempo: number;
  score: { id: string; name: string; midi: number; beat: number; durationBeats: number }[];
  mic: MicSetup | null;
  userAgent: string;
};

/** Frames per second kept while nothing is audible. Audible frames are all kept. */
const QUIET_HZ = 10;
const LIMIT = 6000;

let on = enabledByDefault();
let session: MicSession | null = null;
let events: MicEvent[] = [];
let seq = 0;
let startedMs = 0;
let lastSampleMs = 0;
let lastPath: string | null = null;

function enabledByDefault(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const flag = new URLSearchParams(window.location.search).get("miclog");
  if (flag === "off") {
    return false;
  }
  if (flag === "on") {
    return true;
  }
  return window.localStorage?.getItem("pianolab.miclog") !== "off";
}

export function micLogEnabled(): boolean {
  return on;
}

export function startMicLog(info: Omit<MicSession, "startedAt" | "mic" | "userAgent">): void {
  session = {
    ...info,
    startedAt: new Date().toISOString(),
    mic: null,
    userAgent: navigator.userAgent,
  };
  events = [];
  seq = 0;
  startedMs = performance.now();
  lastSampleMs = 0;
  lastPath = null;
}

export function recordMicSetup(setup: MicSetup): void {
  if (session) {
    session.mic = setup;
  }
}

/**
 * The reason a note went missing is in the frames where nothing was reported, so
 * every frame with something audible in it is kept, along with every change in
 * the detector's reasoning. Silence is thinned to a heartbeat.
 */
export function shouldSampleFrame(pitch: PitchDiagnostics | null, audible: boolean): boolean {
  if (!on || session === null) {
    return false;
  }
  if (audible) {
    return true;
  }
  const path = pitch?.path ?? null;
  if (path !== lastPath) {
    return true;
  }
  return performance.now() - lastSampleMs >= 1000 / QUIET_HZ;
}

export function recordMicEvent(event: Omit<MicEvent, "seq" | "at">): void {
  if (!on || session === null) {
    return;
  }
  const nowMs = performance.now();
  lastSampleMs = nowMs;
  lastPath = event.pitch?.path ?? null;
  events.push({ ...event, seq: seq++, at: (nowMs - startedMs) / 1000 });
  if (events.length > LIMIT) {
    events.splice(0, events.length - LIMIT);
  }
}

/** Partial strengths live around 1e-3, timestamps in the hundreds: neither reads well rounded the other's way. */
function trim(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (value !== 0 && Math.abs(value) < 1) {
    return Number(value.toPrecision(4));
  }
  return Math.round(value * 1000) / 1000;
}

/** `lastSeconds` trims the log to the tail, which is where a failure just happened. */
export function micLogJson(lastSeconds?: number): string {
  const kept =
    lastSeconds === undefined
      ? events
      : events.filter((event) => event.at >= (events.at(-1)?.at ?? 0) - lastSeconds);
  return JSON.stringify({ session, events: kept }, (_key, value) =>
    typeof value === "number" ? trim(value) : value,
  );
}

export function micLogSize(): number {
  return events.length;
}

export async function copyMicLog(lastSeconds?: number): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(micLogJson(lastSeconds));
    return true;
  } catch {
    return false;
  }
}

export function downloadMicLog(): void {
  const blob = new Blob([micLogJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pianolab-mic-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Console handle, so a log can be pulled without touching the UI. */
export function installMicLogConsole(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (on) {
    console.info("mic log on · micLog.download(), micLog.copy(15), micLog.off()");
  }
  (window as unknown as Record<string, unknown>).micLog = {
    get size() {
      return events.length;
    },
    json: micLogJson,
    events: () => events,
    copy: copyMicLog,
    download: downloadMicLog,
    on() {
      on = true;
      window.localStorage?.removeItem("pianolab.miclog");
    },
    off() {
      on = false;
      window.localStorage?.setItem("pianolab.miclog", "off");
    },
  };
}
