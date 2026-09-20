import { frequencyToMidi, rms, yinPitch, type DetectedNote } from "@pianolab/engine";

export type MicHearing = {
  rms: number;
  midi: number | null;
  cents: number | null;
};

export async function startMicPitch(
  ctx: AudioContext,
  onDetected: (note: DetectedNote) => void,
  onHearing?: (hearing: MicHearing) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
  const source = ctx.createMediaStreamSource(stream);
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 70;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(highpass);
  highpass.connect(analyser);
  analyser.connect(silent);
  silent.connect(ctx.destination);

  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  let stopped = false;

  const loop = () => {
    if (stopped) {
      return;
    }
    analyser.getFloatTimeDomainData(buf);
    const level = rms(buf);
    if (level > 0.003) {
      const pitch = yinPitch(buf, ctx.sampleRate, 0.2);
      if (pitch && pitch.probability > 0.55) {
        const { midi, cents } = frequencyToMidi(pitch.frequency);
        onHearing?.({ rms: level, midi, cents });
        onDetected({ midi, cents, t: ctx.currentTime });
      } else {
        onHearing?.({ rms: level, midi: null, cents: null });
      }
    } else {
      onHearing?.({ rms: level, midi: null, cents: null });
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
    silent.disconnect();
    stream.getTracks().forEach((track) => track.stop());
  };
}
