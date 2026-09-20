---
name: kanban-markdown
description: >-
  Create, update, and move Pianolab work items on the Kanban Markdown board
  in .devtool/features/. Use at the start of any implementation, bugfix,
  refactor, or research task; when the user asks to track work; when finishing
  or pausing a task; and whenever a new distinct work item appears mid-session.
---

# Kanban Markdown

Board files: `.devtool/features/`. Extension: `LachyFS.kanban-markdown`.

## Required workflow

1. **Find or create** a card before changing code.
2. Set `status: "in-progress"` while working.
3. On finish: `done`, `completedAt` now (ISO), move file to `done/`.
4. New items that appear mid-session get their own cards.

Active statuses stay at `{featuresDir}/{id}.md`. Only `done` uses `{featuresDir}/done/{id}.md`.

## ID

Lowercase title, keep `a-z 0-9 - space`, spaces → `-`, collapse `-`, trim, max 50 chars, append `-YYYY-MM-DD`. Empty slug → `feature-YYYY-MM-DD`. Filename is `{id}.md`. Never change `id` or `created` after write.

## Frontmatter

Quoted strings. Bare `null` for empty `assignee`, `dueDate`, `completedAt`. Labels: `[]` or `["feature"]`. `order`: next key in that column (`a0`, `a1`, …). Field order must be:

`id`, `status`, `priority`, `assignee`, `dueDate`, `created`, `modified`, `completedAt`, `labels`, `order`

```markdown
---
id: "short-title-2026-09-19"
status: "in-progress"
priority: "medium"
assignee: null
dueDate: null
created: "2026-09-19T14:00:00.000Z"
modified: "2026-09-19T14:00:00.000Z"
completedAt: null
labels: ["feature"]
order: "a0"
---

# Short title

What and why. Acceptance notes if known.
```

`status`: `backlog` | `todo` | `in-progress` | `review` | `done`  
`priority`: `critical` | `high` | `medium` | `low`

Always bump `modified` on edit. Moving to `done` sets `completedAt` and relocates the file. Moving out of `done` clears `completedAt` and moves the file back to the features root.
