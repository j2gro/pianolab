---
id: "mic-hears-unplayed-notes-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T00:48:00.000Z"
modified: "2026-09-22T02:05:00.000Z"
completedAt: null
labels: ["bug"]
order: "a12"
---

# Mic hears unplayed notes

After the C4 pickup fix, the mic reports notes that are not being played. Stop matching the waiting pitch on background sound, while still counting C4 when YIN locks on a real partial.

Root cause: `detectHeardPitch` promotes any detection to the expected note on `isHarmonicHit` alone, which is a pure frequency-ratio test. With C4 expected, an isolated G5 or E6 is rewritten to "C4, 0 cents".

Acceptance:

- Promotion to the expected note requires evidence in the signal: several of the expected note's own partials present, counting only the ones the detected tone cannot account for by itself.
- A C4 whose fundamental is weak still counts as C4; an isolated G5 or C5 reports itself.
- Reported cents are measured, not hardcoded to 0.
- The noise floor keeps adapting when a pitch is present, so steady tonal noise raises the gate instead of freezing it.

`nsdfAtFrequency` was written for this and is now deleted rather than wired in: a periodicity test cannot reject a fundamental below the one playing, since a signal that repeats at T repeats at 2T too. See `mic-reports-note-an-octave-low-2026-09-22`. The spectral partial test does the discriminating, including rejecting noise.
