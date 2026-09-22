---
id: "telemetry-for-detected-notes-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T02:40:00.000Z"
modified: "2026-09-22T03:20:00.000Z"
completedAt: null
labels: ["enhancement"]
order: "a0"
---

# Telemetry for detected notes

Listener bugs have been diagnosed by reasoning about synthetic fixtures and asking the player what happened. Record what the listener actually did during practice instead, so pickup failures can be read off a log.

Every fix so far turned on knowing which note was expected when a detection arrived: the sub-octave phantom only showed up as "E4 reads as E3", and E4 being masked was only findable once it was clear F4 was still ringing a semitone above. So the expected note at, or near, the time of the detection is the point of this.

## Record per detection

- Audio time, musical time, and beat.
- What was reported: midi, cents, rms.
- Which path reported it: pitch reading inside the snap window, partials present alongside a detected pitch, partials present with no pitch found, or a plain YIN reading with no expected note involved.
- Raw YIN output: frequency and probability, or that it found no period.
- Strength at each probed partial of the expected note, plus which partials were skipped as unresolvable. These are the numbers currently measured by hand in a scratch script.
- Gate state: RMS, the adaptive noise floor, and the gate threshold.
- Onset gate decision: new pitch, restrike, or suppressed, with the level ratio that drove it.

## Record the expected note alongside it

- Expected note id, midi, and visual state (`upcoming`, `due`, `waiting`).
- Offset from that note's attack, signed, so early and late plays are distinguishable.
- The previous note: midi and how long since its attack. A neighbour struck 400ms earlier is still ringing and is what defeats the detector.
- Any other lesson note within about a beat either side, since that is the window where an overlapping note can mask the expected one.
- What the transport did with it: hit, wrong, or ignored, and for ignored, which early return.

## Also record once per session

- Sample rate, `fftSize`, and the `getSettings()` values actually granted for echo cancellation, noise suppression, and auto gain control. Which `getUserMedia` attempt succeeded matters, because the last fallback silently re-enables all three.
- Lesson, phrase, mode, and tempo.

## Shape

- Off by default, behind a flag (query parameter or `localStorage`), so the per-frame probes and allocation stay out of a normal session.
- Fixed-size ring buffer in memory, capped at a few thousand events, with a way to copy or download the whole thing as JSON from the practice view. No backend.
- Derived measurements only, never raw audio.

## Design note

`detectHeardPitch` returns only `{ rms, midi, cents }`, so its decision path and partial strengths are not visible to a caller. It needs an optional diagnostics channel, filled in only when telemetry is on, so the hot path is unchanged when it is off.

## Built

Two deliberate departures from the plan above:

- **On by default**, off with `?miclog=off` or `micLog.off()` (remembered in `localStorage`). E4 is being chased right now and a flag nobody remembers to set records nothing. Worth turning back off once it is fixed.
- **Per frame, not per detection.** A missed note leaves no detection to hang a record on, so the interesting frames are the ones where nothing was reported. Every frame with audio above the gate is kept, at whatever rate the animation frame runs; silence is thinned to 10Hz, and the ring holds 6000 events.

Where it lives:

- `PitchDiagnostics` (`packages/engine/src/detect.ts`): decision path, YIN frequency and probability, expected frequency, and every probed partial with its strength and whether it was skipped as unresolvable. `path` is one of `below-floor`, `gated`, `no-pitch`, `snap`, `partials`, `partials-alone`, `reading`. Passed in by the caller, so nothing is allocated or probed when it is absent.
- `OnsetDiagnostics` (`packages/engine/src/onset.ts`): `attack`, `restrike`, `held`, or `no-pitch`, with the note being held, the level ratio against one lookback ago, and time since the last onset.
- `DetectionVerdict` (`packages/engine/src/types.ts`): `reportDetected` now returns what it did — `hit`, `wrong`, or which early return it took (`idle`, `listen-mode`, `lesson-done`, `not-due`, `not-expected`).
- `apps/web/src/audio/telemetry.ts`: the ring buffer, session record, and JSON output. Numbers under 1 keep four significant digits so partial strengths around 1e-3 survive; the rest round to milliseconds.
- `apps/web/src/audio/mic.ts` takes an options object now and reports the granted `getSettings()` and which `getUserMedia` attempt won.
- `PracticeView` adds the musical context (expected note, its state, offset from due, the previous note, what the score has sounding) and the transport verdict. Keyboard and MIDI plays are recorded too, as `source: "keys"`, which is what separates a listener failure from a transport failure.

Getting a log out: **More → Save mic log** (or **Copy mic log**), or `micLog.download()`, `micLog.copy(15)` for the last 15 seconds, `micLog.size` in the console.

Acceptance: covered by `detect.test.ts` (path names, probe strengths, no probing below the floor), `onset.test.ts` (decisions and the restrike ratio), and `transport.test.ts` (every verdict). Still needs one real recorded session read end to end to confirm the log answers the E4 question.
