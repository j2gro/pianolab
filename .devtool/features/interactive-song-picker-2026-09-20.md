---
id: "interactive-song-picker-2026-09-20"
status: "backlog"
priority: "medium"
assignee: null
dueDate: null
created: "2026-09-20T17:06:00.000Z"
modified: "2026-09-20T17:06:00.000Z"
completedAt: null
labels: ["feature"]
order: "a0"
---

# Interactive song picker filters

Replace the HUD `<select>` song picker with a more interactive catalog UI. Users can filter songs by **difficulty** (beginner, intermediate, advanced) and by **hands** (one hand vs two hands).

Depends on catalog `difficulty` from `golden-lesson-difficulty-2026-09-20`. Hands filter can derive from notes (`left` present → two hands; otherwise one hand) unless a dedicated lesson field is added.

Acceptance:

- Filters for difficulty and one/two hands; combining them narrows the list.
- Empty filter result is clear; picker still lets the user pick a remaining song.
- Current lesson stays valid if it still matches; if it is filtered out, selection updates to a visible song (or an explicit empty state).
- Keyboard and screen-reader usable (not only mouse).
