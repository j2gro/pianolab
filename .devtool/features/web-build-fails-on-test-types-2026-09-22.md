---
id: "web-build-fails-on-test-types-2026-09-22"
status: "review"
priority: "high"
assignee: null
dueDate: null
created: "2026-09-22T03:05:00.000Z"
modified: "2026-09-22T03:05:00.000Z"
completedAt: null
labels: ["bug"]
order: "a0"
---

# Web build fails on test types

`npm run build --workspace @pianolab/web` fails before Vite runs:

```
src/piano/layout.test.ts(1,20): error TS2591: Cannot find name 'node:assert/strict'.
src/piano/layout.test.ts(2,22): error TS2591: Cannot find name 'node:test'.
```

`tsconfig.app.json` sets `types: ["vite/client"]`, which replaces the default set, so nothing in the project sees Node's types. `src/piano/layout.test.ts` imports `node:test` and `node:assert/strict` and is run with `tsx`, so it needs them. `@types/node` is already a dependency of the workspace.

The dev server does not typecheck, which is why this only shows up on `build` and `typecheck`.

## Acceptance

- `npm run build --workspace @pianolab/web` reaches `vite build` and succeeds.
- `npm run typecheck` is clean across the repo.
- Browser sources keep their DOM typings; nothing starts relying on Node globals.
