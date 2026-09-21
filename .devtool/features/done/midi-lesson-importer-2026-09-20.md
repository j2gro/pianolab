---
id: "midi-lesson-importer-2026-09-20"
status: "done"
priority: "medium"
assignee: null
dueDate: null
created: "2026-09-20T13:32:00.000Z"
modified: "2026-09-20T13:50:00.000Z"
completedAt: "2026-09-20T13:50:00.000Z"
labels: ["feature"]
order: "a3"
---

# MIDI lesson importer

Dev CLI in `@pianolab/lesson-schema` that maps a `.mid` file to lesson JSON (`midi`, `beat`, `durationBeats`, draft fingering, phrases). Validate with `parseLesson` before write. No song catalog or in-app picker in this card.

Shipped: `npm run lesson:import -- file.mid` with `--list-tracks`, quantize, monophonic collapse, phrase split. README authoring notes.
