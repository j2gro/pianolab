type Voice = {
  midi: number;
  oscs: OscillatorNode[];
  gain: GainNode;
};

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Time constant for string decay: bass rings longer than treble. */
export function stringDecayTau(midi: number): number {
  const t = Math.min(1, Math.max(0, (midi - 21) / 87));
  return 2.6 - t * 2.0;
}

function dampVoice(voice: Voice, now: number, tau: number): void {
  const gain = voice.gain.gain;
  try {
    gain.cancelAndHoldAtTime(now);
    gain.setTargetAtTime(0.0001, now, tau);
    const stopAt = now + tau * 5;
    for (const osc of voice.oscs) {
      osc.stop(stopAt);
    }
  } catch {
    // already stopped
  }
}

export function createPianoSynth(ctx: AudioContext) {
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -18;
  master.knee.value = 10;
  master.ratio.value = 2.5;
  master.attack.value = 0.004;
  master.release.value = 0.18;
  master.connect(ctx.destination);

  const voices: Voice[] = [];

  return {
    play(midi: number, durationSec: number) {
      const now = ctx.currentTime;
      for (const previous of voices.filter((voice) => voice.midi === midi)) {
        dampVoice(previous, now, 0.025);
      }

      const freq = midiToFreq(midi);
      const hold = Math.max(0.06, durationSec);
      const attack = 0.006;
      const peak = 0.2;
      const decayTau = stringDecayTau(midi);
      const releaseTau = 0.09;
      const off = now + hold;
      const stopAt = off + 0.55;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      const bright = 1400 + ((midi - 21) / 87) * 4200;
      const dark = 700 + ((midi - 21) / 87) * 1800;
      filter.frequency.setValueAtTime(bright, now);
      filter.frequency.setTargetAtTime(dark, now + attack, 0.12);
      filter.Q.value = 0.85;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + attack);
      gain.gain.setTargetAtTime(0.0001, now + attack, decayTau);
      gain.gain.setTargetAtTime(0.0001, off, releaseTau);

      filter.connect(gain);
      gain.connect(master);

      const oscs: OscillatorNode[] = [];
      const partials: Array<{ type: OscillatorType; ratio: number; level: number }> = [
        { type: "sine", ratio: 1, level: 0.7 },
        { type: "sine", ratio: 2, level: 0.28 },
        { type: "sine", ratio: 3, level: 0.14 },
        { type: "sine", ratio: 4.01, level: 0.06 },
        { type: "triangle", ratio: 1, level: 0.1 },
      ];
      for (const partial of partials) {
        const osc = ctx.createOscillator();
        const mix = ctx.createGain();
        osc.type = partial.type;
        osc.frequency.value = freq * partial.ratio;
        mix.gain.value = partial.level;
        osc.connect(mix);
        mix.connect(filter);
        osc.start(now);
        osc.stop(stopAt);
        oscs.push(osc);
      }

      const voice: Voice = { midi, oscs, gain };
      voices.push(voice);
      oscs[0]!.onended = () => {
        const index = voices.indexOf(voice);
        if (index >= 0) {
          voices.splice(index, 1);
        }
        try {
          filter.disconnect();
          gain.disconnect();
        } catch {
          // already disconnected
        }
      };
    },
    stopAll() {
      const now = ctx.currentTime;
      for (const voice of voices) {
        dampVoice(voice, now, 0.03);
      }
      voices.length = 0;
    },
  };
}
