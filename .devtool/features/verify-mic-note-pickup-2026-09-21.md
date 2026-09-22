---
id: "verify-mic-note-pickup-2026-09-21"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T00:31:00.000Z"
modified: "2026-09-22T01:40:00.000Z"
completedAt: null
labels: ["bug"]
order: "a11"
---

# Verify mic note pickup

The mic is having trouble picking up notes. Confirm YIN + matcher + wait-mode wiring actually lock onto piano-like pitches, then fix whatever fails.

C4 was missed when YIN locked on the 3rd partial (G). Twinkle C4 notes advance with a 3rd-harmonic-heavy C4 stream; G4 does not count as C.

The periodicity check described here was written (`nsdfAtFrequency`) but never wired in; the detector matched on frequency ratios alone. Replaced by a spectral partial test under `mic-hears-unplayed-notes-2026-09-22`, because periodicity cannot tell a note from the octave below it.
