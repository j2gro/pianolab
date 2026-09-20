---
id: "practice-phrase-blank-screen-2026-09-19"
status: "done"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-20T02:06:00.000Z"
modified: "2026-09-20T02:10:00.000Z"
completedAt: "2026-09-20T02:10:00.000Z"
labels: ["bug"]
order: "a8"
---

# Practice phrase blank screen

R3F Canvas crashed on Invalid hook call (two React copies) and a 0-height parent, which unmounted the tree. Fixed by pinning a single React, giving the scene a real height, and wrapping the canvas in an error boundary.
