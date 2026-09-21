export const PLAY_ALONG_COUNT_IN_SEC = 5;

export function beatSec(tempo: number): number {
  return 60 / Math.max(1, tempo);
}

export function playAlongLeadInSec(tempo: number): number {
  return PLAY_ALONG_COUNT_IN_SEC + beatSec(tempo);
}

/** 5–1 during the numbered count-in; null during the extra beat after 1. */
export function playAlongCountDigit(timeSec: number, tempo: number): number | null {
  if (timeSec >= 0) {
    return null;
  }
  const numbered = -timeSec - beatSec(tempo);
  if (numbered <= 1e-6) {
    return null;
  }
  return Math.min(PLAY_ALONG_COUNT_IN_SEC, Math.max(1, Math.ceil(numbered)));
}
