---
id: "mic-capture-range-and-cost-2026-09-22"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2026-09-22T01:00:00.000Z"
modified: "2026-09-22T01:00:00.000Z"
completedAt: null
labels: ["enhancement"]
order: "a1"
---

# Mic capture range and cost

Deferred findings from the tone-sensing review, none of which block current C4-C5 lessons.

- `yinPitch` searches lags for 70-1000Hz only, so nothing above B5 or below C#2 is ever detected.
- The difference loop covers every lag up to `half` (4.2M inner iterations per frame at 48kHz) although only lags in the search range are used and the CMNDF running sum only needs lags up to `tauMax`. Capping it is a free 3x cut; an AudioWorklet would stop competing with React and the Three.js scene.
- `reportDetected` judges early/late windows from `now()` and never reads `DetectedNote.t`, so an accurate onset timestamp buys nothing and any queueing delay is charged to the player.
- The cents tolerance is 60 in three separate places: `PITCH_EXPECTED_CENTS` in the detector, `PracticeView`'s HUD verdict, and `DEFAULT_CENTS` in the transport. They agree numerically now but nothing keeps them in step.
- The third `getUserMedia` fallback is bare `{}`, which silently re-enables echo cancellation, noise suppression, and AGC. No `getSettings()` check and no warning to the user.
- The `MediaStreamDestination` tap's tracks are never stopped in cleanup.
