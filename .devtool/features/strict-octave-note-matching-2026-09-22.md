---
id: "strict-octave-note-matching-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T01:00:00.000Z"
modified: "2026-09-22T01:40:00.000Z"
completedAt: null
labels: ["bug"]
order: "a14"
---

# Strict octave note matching

`midiDistanceCents` folds octaves (`diff -= 12 * Math.round(diff / 12)`), so C3 and C5 both satisfy an expected C4. On a piano an octave error is a wrong note, and the folding also hid detector octave errors instead of fixing them.

Acceptance:

- `isPitchHit` only accepts the expected pitch, not other octaves of it.
- `isHarmonicHit` checks partials of the expected fundamental only; the `expectedMidi + 12 / + 24` loop goes away.
- The detector resolves the octave itself, so a played C4 whose 2nd partial dominates is still reported as C4 rather than C5.
