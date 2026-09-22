export type YinResult = {
  frequency: number;
  probability: number;
};

export const YIN_MIN_HZ = 70;
export const YIN_MAX_HZ = 1000;

export function yinPitch(
  buf: Float32Array,
  sampleRate: number,
  threshold = 0.15,
): YinResult | null {
  const n = buf.length;
  const half = Math.floor(n / 2);
  if (half < 32) {
    return null;
  }

  const diff = new Float32Array(half);
  for (let tau = 1; tau < half; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const delta = buf[i]! - buf[i + tau]!;
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  const cmndf = new Float32Array(half);
  cmndf[0] = 1;
  let running = 0;
  for (let tau = 1; tau < half; tau++) {
    running += diff[tau]!;
    cmndf[tau] = (diff[tau]! * tau) / running;
  }

  const tauMin = Math.max(2, Math.floor(sampleRate / YIN_MAX_HZ));
  const tauMax = Math.min(half - 1, Math.floor(sampleRate / YIN_MIN_HZ));
  let tauEst = -1;
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmndf[tau]! < threshold) {
      while (tau + 1 < tauMax && cmndf[tau + 1]! < cmndf[tau]!) {
        tau += 1;
      }
      tauEst = tau;
      break;
    }
  }

  if (tauEst < 0 || cmndf[tauEst]! >= threshold) {
    return null;
  }

  const x0 = tauEst > 0 ? cmndf[tauEst - 1]! : cmndf[tauEst]!;
  const x1 = cmndf[tauEst]!;
  const x2 = tauEst + 1 < half ? cmndf[tauEst + 1]! : cmndf[tauEst]!;
  const denom = 2 * (2 * x1 - x2 - x0);
  const better = denom === 0 ? tauEst : tauEst + (x2 - x0) / denom;
  if (better <= 0) {
    return null;
  }

  return {
    frequency: sampleRate / better,
    probability: 1 - x1,
  };
}

export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i]!;
    sum += s * s;
  }
  return Math.sqrt(sum / buf.length);
}

/**
 * Goertzel power at one frequency as a share of total buffer power. Periodicity
 * alone cannot tell a note from an isolated partial of it, because a tone at
 * 3*f0 repeats at f0 too; this says whether that frequency carries any energy.
 */
export function toneStrengthAt(buf: Float32Array, sampleRate: number, frequency: number): number {
  const n = buf.length;
  if (n < 32 || frequency <= 0 || frequency >= sampleRate / 2) {
    return 0;
  }
  const coeff = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const x = buf[i]!;
    const s0 = x + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
    energy += x * x;
  }
  if (energy <= 1e-20) {
    return 0;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (energy * n);
}
