---
id: "mic-walks-lesson-on-desk-noise-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T02:50:00.000Z"
modified: "2026-09-22T02:55:00.000Z"
completedAt: null
labels: ["bug"]
order: "a0"
---

# Mic walks lesson on desk noise

Canon wait-mode scored a cascade of expected notes from desk vibration while the mouse was bounced up and down. No piano notes were played.

Session `2026-09-22T02:48:45Z`: ~20 mic attacks between 18s and 51s, all `source:"mic"` `path:"partials-alone"`. Peaks clustered 0.003–0.024, often 2–4 expected bins just over `PITCH_TONE_MIN`. Confirmed path bypassed the adaptive gate; each new expected midi looked like a fresh attack.

Acceptance:

- Broadband desk / mouse thumps do not confirm the waiting note.
- Quiet real E4 and F#3 still confirm (partials clearly above nearby off-harmonic bins).
- A2 ringing still does not walk the following Canon notes.

## Fix

`partials` / `partials-alone` now also require harmonic contrast: the strongest expected partial must out-peak the bins halfway between harmonics by `PITCH_HARMONIC_CONTRAST_MIN` (4). Piano sits at 70× or more; desk modes and clicks sit near 1–3. The half-RMS floor (added for quiet F#3) is reverted — those desk hits were at rms 0.0006; real F#3 was already above `PITCH_RMS_MIN`.

57 engine tests passing, including desk-ring and mouse-click fixtures that must not score as the waiting Canon notes.
