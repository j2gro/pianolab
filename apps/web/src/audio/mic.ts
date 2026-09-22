import {
  applyAdaptiveGate,
  createOnsetGate,
  detectHeardPitch,
  newOnsetDiagnostics,
  newPitchDiagnostics,
  PITCH_RMS_MIN,
  type DetectedNote,
  type OnsetDiagnostics,
  type PitchDiagnostics,
} from "@pianolab/engine";

export type MicHearing = {
  rms: number;
  midi: number | null;
  cents: number | null;
  /** Level a frame has to clear to be looked at, from the noise floor. */
  gate: number;
  noiseFloor: number;
  /** Audio clock time the sound happened, latency already taken off. */
  t: number;
  /** Set when the onset gate passed this frame on as a strike. */
  attack: DetectedNote | null;
  pitch: PitchDiagnostics | null;
  onset: OnsetDiagnostics | null;
};

export type MicSetup = {
  sampleRate: number;
  fftSize: number;
  /** Which constraint set the browser accepted. 0 is the strictest. */
  constraintAttempt: number;
  track: MediaTrackSettings | null;
};

export type MicOptions = {
  onDetected: (note: DetectedNote) => void;
  onHearing?: (frame: MicHearing) => void;
  expectedMidi?: () => number | null;
  /** The note before the expected one, still ringing into this frame. */
  previousMidi?: () => number | null;
  /** Fill in per-frame reasoning. Costs a few extra probes a frame. */
  diagnostics?: boolean;
  onSetup?: (setup: MicSetup) => void;
};

async function openMicStream(): Promise<{ stream: MediaStream; attempt: number }> {
  const attempts: MediaTrackConstraints[] = [
    {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
    {
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    },
    {},
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: attempts[attempt]! });
      return { stream, attempt };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Microphone unavailable");
}

export async function startMicPitch(
  ctx: AudioContext,
  { onDetected, onHearing, expectedMidi, previousMidi, diagnostics = false, onSetup }: MicOptions,
): Promise<() => void> {
  const { stream, attempt } = await openMicStream();
  const source = ctx.createMediaStreamSource(stream);
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 70;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  // Keep the capture graph live without routing the mic to speakers (which can
  // trigger echo cancellation and strip piano).
  const tap = ctx.createMediaStreamDestination();
  source.connect(highpass);
  highpass.connect(analyser);
  analyser.connect(tap);

  onSetup?.({
    sampleRate: ctx.sampleRate,
    fftSize: analyser.fftSize,
    constraintAttempt: attempt,
    track: stream.getAudioTracks()[0]?.getSettings() ?? null,
  });

  const buf = new Float32Array(analyser.fftSize);
  // The analyser hands back a window of history, so its midpoint is when the
  // sound actually happened.
  const windowLagSec = analyser.fftSize / (2 * ctx.sampleRate);
  const onset = createOnsetGate();
  let raf = 0;
  let stopped = false;
  let noiseRms = 0.003;

  const loop = () => {
    if (stopped) {
      return;
    }
    analyser.getFloatTimeDomainData(buf);
    const pitchDiag = diagnostics ? newPitchDiagnostics() : undefined;
    let heard = detectHeardPitch(
      buf,
      ctx.sampleRate,
      expectedMidi?.() ?? null,
      pitchDiag,
      previousMidi?.() ?? null,
    );
    // Track the quietest recent level rather than only pitchless frames, so a
    // steady hum that YIN latches onto still raises the gate.
    noiseRms = heard.rms < noiseRms ? heard.rms : noiseRms * 0.999 + heard.rms * 0.001;
    const gate = Math.max(PITCH_RMS_MIN, noiseRms * 4);
    heard = applyAdaptiveGate(heard, gate);
    if (pitchDiag) {
      pitchDiag.path = heard.path;
    }
    const onsetDiag = diagnostics ? newOnsetDiagnostics() : undefined;
    const t = ctx.currentTime - windowLagSec;
    const attack = onset({ ...heard, t }, onsetDiag);
    onHearing?.({
      ...heard,
      gate,
      noiseFloor: noiseRms,
      t,
      attack,
      pitch: pitchDiag ?? null,
      onset: onsetDiag ?? null,
    });
    if (attack) {
      onDetected(attack);
    }
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    source.disconnect();
    highpass.disconnect();
    analyser.disconnect();
    stream.getTracks().forEach((track) => track.stop());
  };
}
