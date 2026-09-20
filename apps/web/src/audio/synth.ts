export function createPianoSynth(ctx: AudioContext) {
  const voices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  return {
    play(midi: number, durationSec: number) {
      const freq = 440 * 2 ** ((midi - 69) / 12);
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      const now = ctx.currentTime;
      const dur = Math.max(0.12, durationSec);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      const voice = { osc, gain };
      voices.push(voice);
      osc.onended = () => {
        const index = voices.indexOf(voice);
        if (index >= 0) {
          voices.splice(index, 1);
        }
      };
    },
    stopAll() {
      const now = ctx.currentTime;
      for (const voice of voices) {
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
          voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
          voice.osc.stop(now + 0.05);
        } catch {
          // already stopped
        }
      }
      voices.length = 0;
    },
  };
}
