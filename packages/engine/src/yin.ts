export type YinResult = {
  frequency: number;
  probability: number;
};

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

  const tauMin = Math.max(2, Math.floor(sampleRate / 1000));
  const tauMax = Math.min(half - 1, Math.floor(sampleRate / 70));
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
