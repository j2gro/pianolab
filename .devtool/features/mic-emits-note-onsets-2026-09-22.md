---
id: "mic-emits-note-onsets-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T01:00:00.000Z"
modified: "2026-09-22T02:05:00.000Z"
completedAt: null
labels: ["bug"]
order: "a15"
---

# Mic emits note onsets

`startMicPitch` calls `onDetected` on every animation frame a pitch is present, so a held note fires about 60 note events per second. Nothing tracks note-off or re-attack, so one sustained C clears both C's at the start of Twinkle, and `PracticeView` re-renders the whole scene on every frame of held sound.

The mic should behave like the keyboard adapter: one event per attack.

Acceptance:

- A held pitch reports one attack; the same pitch struck again after decaying reports a second attack.
- Onset timestamps subtract the analysis-window delay, so `DetectedNote.t` is when the sound happened rather than when the frame was read. Note that the transport judges due-ness from `now()` and ignores the timestamp, so this does not move scoring yet; that is tracked separately.
- The envelope logic lives in the engine with unit tests, not in browser-only code.

A strike is found by a level rise of `RESTRIKE_RISE_RATIO` over the last 100ms, with a 200ms refractory so the analysis window filling up is not read as a second strike. The first rule tried required the note to decay to 60% of its peak first, which never happens on a piano at one strike per beat.

Known limit: a repeat softer than the still-ringing first note raises the level by only ~20% and is missed. Loosening the ratio is not the answer, because detuned unison strings beat by a similar amount and would invent notes. Catching that case needs an attack measure rather than a level measure, for example the energy in the differenced signal, which rises on a hammer strike but not on a smooth decay.
