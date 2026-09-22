---
id: "a2-reverb-skips-follow-notes-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T02:41:00.000Z"
modified: "2026-09-22T02:58:00.000Z"
completedAt: null
labels: ["bug"]
order: "a0"
---

# A2 reverb skips follow notes

Canon wait-mode, session `2026-09-22T02:39:09Z`. A2 (`n005`) hit at 30.99s via `partials-alone`. The next four notes then scored in 140ms from the same ringing buffer as the expected note changed:

| at | expected | path | why it passed |
| --- | --- | --- | --- |
| 31.00 | C#3 | partials-alone | fund 0.024 (leakage at 138Hz) + A2's 5th as the 4th |
| 31.05 | E3 | partials-alone | 3 partials, all A2 harmonics (3rd/6th/9th) |
| 31.07 | A3 | partials-alone | A2's octave series |
| 31.13 | B2 | partials-alone | fund + 2nd just over 0.002 |

The F#3 relaxation — two partials with a fund, or three without — is what lets a low note's overtones satisfy the next expected note. The onset gate then sees a midi change and emits a new attack.

Fix: when the previous note is still sounding, only accept the expected note if it has three partials that are *not* harmonics of the previous note. F#3 under D3 still qualifies; A2's children do not.

Wired `previousMidi` from the score into `detectHeardPitch`. 53 engine tests passing.

## Still walking after the desk-noise contrast fix

Same Canon wait, A2 `n005` at 25.11s (`partials-alone`, 6th 0.120, 3rd almost gone). The next three notes scored from the same ring:

| at | expected | previous | C#3/E3/A3 probes |
| --- | --- | --- | --- |
| 25.76 | C#3 | A2 | 0.020, 0.0023, 0.0020 — leakage at 138Hz plus two floor bins |
| 25.78 | E3 | C#3 | 0.028 at 165Hz (1.5×A2) |
| 25.87 | A3 | E3 | 0.017 at the 3rd (A2's 6th) |

Once C#3 scored, the guard was watching C#3, not A2, so E3 and A3 were free.

Follow-up: two unexplained partials must each be ≥ 0.008, not merely 0.002; leftover previous energy (peak ≥ 0.004) still counts as ringing; snap to the expected note is blocked while the previous note explains it. 59 engine tests passing.
