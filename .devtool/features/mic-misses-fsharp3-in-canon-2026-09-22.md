---
id: "mic-misses-fsharp3-in-canon-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T02:36:00.000Z"
modified: "2026-09-22T02:46:00.000Z"
completedAt: null
labels: ["bug"]
order: "a0"
---

# Mic misses F#3 periodically in Canon

Canon left hand is D3 F#3 A3 D4. After the E4 gate fix, F#3 still hangs for several seconds on some attacks and hits immediately on others.

Telemetry from wait-mode Canon at 50 BPM (`2026-09-22T02:31:36Z`):

| id | previous | wait | how it finally hit |
| --- | --- | --- | --- |
| n002 | D3 | 6–52s (restart in the middle) | `partials-alone`, fund 0.0024 |
| n011 | D3 | 7s | `partials-alone`, fund 0.0031 |
| n016 | C#3 | instant | `partials-alone`, fund 0.0022 |
| n035 | D3 | 18s | `partials-alone`, fund 0.0021 |

The misses are not YIN reporting the wrong octave. They are frames where F#3's upper partials are clearly there and the fundamental is not:

| at | fund | present ≥ 0.002 | rms | gate | path |
| --- | --- | --- | --- | --- | --- |
| 51.29 | 0.00057 | 3 (0.016, 0.010, 0.004) | 0.00117 | 0.00185 | gated |
| 51.56 | 0.0013 | 2 | 0.00103 | 0.00198 | gated |

`expectedIsSoundingAlone` requires the fundamental plus three partials. A piano F#3 often puts its energy in the 2nd and 3rd, so the path never confirms, and `applyAdaptiveGate` still throws the frame away. The hits are the strikes where the fund just clears 0.002.

A3-as-E4 still has to fail: A3 only lights E4's 2nd and 4th, so three partials without a fund is the line.

D3's follow-up YIN lock at 147Hz (and its octave at 295Hz) fires a second attack ~60ms after D3 scores, but those frames have no F#3 energy. They flash wrong / not-expected; they do not explain the long waits.

## Fix

`expectedIsSoundingAlone` now passes if the fund is present and two partials are, or if three partials are present without a fund. A3 still only lights two of E4's partials. The 51.29-style F#3 frames confirm and survive the adaptive gate.

## Still intermittent after the A2 cascade guard

Session `2026-09-22T02:43:34Z`: n002 waited 4s, n011 waited 10s. After D3 hits, YIN stays on 147Hz. The A2 fix then required three F#3 partials that D3 does not explain. F#3's 4th sits 14 cents from D3's 5th, so a real F#3 with three present partials including that 4th only had two unexplained and was rejected. Quiet retries sat under the gate with path already `gated`, so they never even entered the log.

Follow-up: ignore a YIN lock on the previous note; require two unexplained partials with a peak of 0.004 (A2→B2 leakage tops out at 0.0026); look down to half the RMS floor when a note is expected. A2's children still fail. 54 tests passing.
