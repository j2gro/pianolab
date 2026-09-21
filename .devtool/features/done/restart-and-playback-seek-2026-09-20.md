---
id: "restart-and-playback-seek-2026-09-20"
status: "done"
priority: "medium"
assignee: null
dueDate: null
created: "2026-09-21T00:19:00.000Z"
modified: "2026-09-21T00:32:00.000Z"
completedAt: "2026-09-21T00:32:00.000Z"
labels: ["feature"]
order: "a0"
---

# Restart and playback seek slider

Add a **Restart** control and a **playback timestamp slider** so the player can jump around a lesson without leaving the session.

Restart returns the session to the beginning of the song (including the existing Listen lead-in / Play along countdown) and clears note hit/miss/wait state so the play window shows the opening notes approaching the hit line again.

The slider represents musical time across the lesson. Moving it seeks the transport to that timestamp. Notes already in the play window must jump immediately to positions that match the new playhead (upcoming, due, sounding, or already past), not wait for the next Start.

Related: Pause is already in the HUD for Listen / Play along (`pause-listen-play-along-2026-09-20`). Tempo already retimes the live session without a Restart (`note-travel-and-practice-layout-2026-09-19`). Engine `createTransport` now exposes `restart` and `seek`.

Acceptance:

- Restart is available after Start (alongside Pause/Resume where those apply).
- Restart resets time, note visuals, and synth/key lights to the same start as a fresh Start.
- A range slider tracks current playback time and can be dragged to any point in the lesson duration.
- Seeking updates `snapshot.timeSec` / note positions in the roll in the same frame as the slider change.
- Seeking while paused stays paused at the new time; seeking while running continues from there.
- Practice (wait) mode still gates on the current note after a seek: the due/waiting note is the one at the new playhead, not a stale earlier note.
