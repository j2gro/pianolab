---
id: "ingest-sheet-music-mxl-2026-09-20"
status: "done"
priority: "medium"
assignee: null
dueDate: null
created: "2026-09-21T00:14:00.000Z"
modified: "2026-09-21T00:25:00.000Z"
completedAt: "2026-09-21T00:25:00.000Z"
labels: ["feature"]
order: "a0"
---

# Ingest sheet_music MXL into the catalog

Scan `C:\sheet_music` for `.mxl` scores that are not already lesson JSON in the library, import them, and register them in the catalog.

Shipped: `npm run lesson:ingest-mxl` skips known slugs/titles, writes lesson JSON, regenerates `catalog.generated.ts`. First run imported 10 new scores.
