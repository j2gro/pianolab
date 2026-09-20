---
id: "v1-product-spec-2026-09-19"
status: "done"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-20T01:40:00.000Z"
modified: "2026-09-20T02:05:00.000Z"
completedAt: "2026-09-20T02:05:00.000Z"
labels: ["research"]
order: "a0"
---

# v1 product spec

Locked concept for Pianolab: a web piano trainer with a Synthesia-style 3D piano-roll, one song (Twinkle Twinkle Little Star), client-side mic matching, and a backend only for auth + lesson progress.

## Decisions

1. Primary practice is **Wait mode**. Play-along is secondary. Listen is the demo.
2. v1 scoring is **monophonic melody** from the on-device mic. No chord or two-hand matching yet.
3. Visual is a **3D piano-roll** (Three.js / R3F). No 3D hands in v1; fingering numbers on note bars.
4. Lesson definitions live as **JSON in git**. Backend stores progress only. No catalog expansion until the loop feels good.
5. Web MIDI is a second `AudioInput` adapter behind the same `DetectedNote` interface. Mic is the product path.

## Runtime (browser, no server on the hot path)

- `Transport` — beat ↔ `AudioContext.currentTime`, tempo, pause/wait.
- `ScorePlayer` — emits note enter/exit from the lesson JSON.
- `AudioInput` — mic (and later MIDI) → `DetectedNote { midi, cents, t }`.
- `Matcher` — expected vs detected → Hit / Wrong / Miss.
- `PianoScene` — consumes matcher/transport events only.

## Transport + matcher

Note states: `upcoming` | `due` | `waiting` | `hit` | `wrong` | `missed`.

**Wait (default):** clock runs until the current note’s attack, then pauses (`waiting`). Matching pitch → `hit` and resume. Wrong stable pitch → `wrong` flash, stay waiting. No miss while waiting.

**Play-along:** clock never waits. Hit if expected pitch arrives in `[t - earlyMs, t + lateMs]` (start ~80ms early / 150ms late). Else `missed`. Wrong pitch in window → `wrong`.

**Listen:** same score, synthesized piano, no matcher.

Pitch: YIN/McLeod in an audio worklet or WASM. Tolerance ~40–50 cents. Map to MIDI. Piano audio never uploads.

## Lesson JSON (sketch)

```ts
type LessonNote = {
  id: string;
  midi: number;
  beat: number;
  durationBeats: number;
  hand: "right";
  finger: 1 | 2 | 3 | 4 | 5;
  lyric?: string;
};
```

Practice unit is a **phrase**, not the whole song. Tempo is a UI control.

## Backend

Auth (email/password or magic link). After a session: `{ hits, wrongs, waitsMs[], completedPhraseIds }`. Users never send recordings in v1.

## v1 done when

Signed-in user opens Twinkle, sees falling numbered notes, hears Listen, switches to Wait, plays the melody, keys light green/red, the next note does not fall until the current one is recognized, phrase completion persists.
