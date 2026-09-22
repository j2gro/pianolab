---
id: "mic-misses-note-under-ringing-neighbour-2026-09-22"
status: "done"
priority: "critical"
assignee: null
dueDate: null
created: "2026-09-22T02:20:00.000Z"
modified: "2026-09-22T02:38:00.000Z"
completedAt: "2026-09-22T02:38:00.000Z"
labels: ["bug"]
order: "a17"
---

# Mic misses a note under a ringing neighbour

Every other note of Twinkle registers; E4 never does. E4 is the one note in the song reached by a descending semitone (F4 F4 E4 E4), so it is always struck while F4 is still ringing a semitone above it.

YIN reports a single period and leans towards the higher of two notes sounding together. Measured against a synthetic F4 ringing over a struck E4:

| F4 level vs E4 | YIN reading | cents from E4 | inside the 60 cent snap |
| --- | --- | --- | --- |
| 0.5x | 332.7Hz | +16 | yes |
| 0.8x | 337.2Hz | +39 | yes |
| 1.0x | no period found | - | no |
| 1.5x | 344.7Hz | +77 | no |
| 3x | 348.3Hz | +95 | no |

So the reading is dragged towards F4 and, when the two are about equal, the period test fails outright and the mic goes deaf.

Fix: stop asking "what single pitch is this" and ask "is the note we are waiting for sounding", by probing the expected note's own partials. Measured shares of buffer power, which are level independent: a sounding E4 holds 3.5e-3 to 8.7e-2 at every partial, a ringing F4 alone holds at most 9.1e-5 at E4's partials, and noise tops out at 7.3e-4. `PITCH_TONE_MIN` sits at 2e-3.

Acceptance:

- E4 is found with F4 ringing anywhere from half to three times its level, including the level where YIN finds no period.
- F4 ringing on its own still reports F4, at any volume.
- A note whose upper partials coincide with the expected note's is not mistaken for it. A3's 3rd and 6th partials land on E4's 2nd and 4th, so with no pitch reading to exclude them, the expected note's own fundamental must be present.
- Partials closer than three analysis bins to a partial of the detected pitch do not count: E4 and F4 fundamentals are under two bins apart, so a loud F4's skirt would otherwise pass as E4.
- Notes confirmed this way report 0 cents. Presence says the note is there, not how well tuned it is.

## Still failing at the piano

The partial probe passes on every synthetic mix above, and E4 still never registers when played for real. So the model of the failure is wrong somewhere the fixtures do not reach, and no more synthetic fixtures should be written for it.

Back to `in-progress` behind `telemetry-for-detected-notes-2026-09-22`, which now records the probe strengths, the YIN reading, the gate levels, the onset gate's decision, and the expected note for every audible frame. The next step is one recorded attempt at the F4 F4 E4 E4 bar, read off the log rather than guessed at.

Hypotheses the log can separate, in order of suspicion:

- The second E4 of the pair is suppressed by the onset gate, not missed by the detector: `held` is already E4, and striking it again over its own ringing does not raise RMS by `RESTRIKE_RISE_RATIO`. The lesson then waits on a note the detector is already reporting. This would read as "E4 never works" even though the detector is right, and it fits E4 being the only note in the song repeated straight after a semitone above it.
- The real F4 is far louder relative to E4 than the 3x fixture, putting every E4 partial inside the unresolvable exclusion.
- A real piano's E4 partials come in under `PITCH_TONE_MIN` once the noise floor and the 70Hz highpass are in play.
- The expected note is not E4 when the strike lands, so the probe never runs for it.

## Telemetry, 2026-09-22 wait-mode Twinkle

Session `2026-09-22T02:17:37Z`, tempo 76, 3762 frames. C4–F4 all hit (several via `partials-alone`). Then 3584 frames waiting on E4 (`n10`, then `n11`).

The ringing-neighbour model was wrong. E4's own partials are present and strong. The frames that prove it never leave the mic:

| at | rms | gate | E4 partials ≥ 0.002 | strongest | path |
| --- | --- | --- | --- | --- | --- |
| 25.08 | 0.00118 | 0.00204 | 5 | 0.075 | gated |
| 29.01 | 0.00122 | 0.00226 | 5 | 0.128 | gated |
| 272.68 | 0.00167 | 0.00197 | 4 | 0.201 | gated |
| 370.74 (`n11`) | 0.00164 | 0.00184 | 5 | 0.162 | gated |

`partials` / `partials-alone` never fired for E4. 3347 of 3584 E4-expected frames were `gated`. Successful F4 hits sat at rms 0.0020–0.0022, just over the same `noiseRms * 4` gate. E4 at this piano/mic is quieter in broadband RMS even when its spectrum is obviously E4.

Two secondary traps on the frames that do clear the gate:

1. YIN locks onto 70–80Hz (`YIN_MIN_HZ` / the 70Hz highpass). 106 such frames. `nearPartialOf` then marks every E4 partial unresolvable, because 35Hz (3 bins at 48kHz/4096) is wide enough that 70×n lands near 330, 659, 989, …. Those frames report midi 37–39 and score `wrong`.
2. A real E4 strike at 325.00–325.48 had fund 0.07–0.20, but YIN said 307Hz then 347Hz. Both are inside 35Hz of E4, so the fundamental (and on the F4 reading, the 2nd too) is skipped. Need 2 remaining partials; only 1 (then 0) remain. Reports Eb4 / F4 as `wrong`. The next frame finally snapped to 329.4Hz and scored the only E4 hit of the session. The immediate `n11` restrike then saw midi 64 `held` for 80ms and later the same gate.

Next fix: stop discarding frames whose expected-note probes already pass, and stop letting a 70Hz YIN reading or a neighbouring semitone veto those probes. The 3-bin exclusion is 183 cents at E4, which is wider than the snap window.

## Fix from that log

- `applyAdaptiveGate` keeps `snap` / `partials` / `partials-alone` even when RMS is under `noiseRms * 4`. A raw YIN `reading` is still dropped. That is the 25s / 272s / 370s frames.
- Partial exclusion is now the 60-cent snap window, not 3 analysis bins. E4 vs F4 (100¢) and E4 vs 70×5 (104¢) stay countable.
- When a note is expected, YIN below 100Hz is treated as no period, so the 70Hz lock does not report D2 or veto E4's probes.

Needs one more real F4 F4 E4 E4 pass. The repeat E4 can still fail the onset restrike if the first E4 is still being held.
