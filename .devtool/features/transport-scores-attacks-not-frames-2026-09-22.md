---
id: "transport-scores-attacks-not-frames-2026-09-22"
status: "review"
priority: "critical"
assignee: null
dueDate: null
created: "2026-09-22T01:00:00.000Z"
modified: "2026-09-22T01:40:00.000Z"
completedAt: null
labels: ["bug"]
order: "a13"
---

# Transport scores attacks, not frames

`reportDetected` gates on a 40ms pitch-stability window (`stableMs`, `stablePc`) that only makes sense for continuous mic frames. Two bugs fall out of it.

Computer-keyboard and MIDI input never register a hit: `startComputerKeyboard` fires once per keydown, and the first event only initialises `stableSince`, so `detected.t - stableSince >= stableMs` is never true. `PracticeView` does not pass `stableMs`, so the default 40ms is live in the app. Every transport test passes `stableMs: 0`, which is why this never showed up.

Wait mode also inflates the wrong-note count roughly 60x per second: a sustained wrong pitch keeps `stablePc` unchanged, stays `waiting`, and re-enters the `else if (expected)` branch every frame, so `wrongs` in the stats sent to `onComplete` is meaningless.

Acceptance:

- One reported attack produces at most one hit or one wrong.
- A single keydown on A-K scores in wait and play-along mode.
- Holding a wrong note counts one wrong; striking it twice counts two.
- `stableMs` is gone from `TransportOptions` and from the tests, so tests exercise the same path as the app.
