---
id: "vercel-hobby-hosting-2026-09-20"
status: "done"
priority: "medium"
assignee: null
dueDate: null
created: "2026-09-21T00:57:00.000Z"
modified: "2026-09-21T01:05:00.000Z"
completedAt: "2026-09-21T01:05:00.000Z"
labels: ["research"]
order: "a0"
---

# Vercel Hobby hosting

Can the POC run on Vercel’s $0 Hobby plan with reliable public access?

## Finding

The **web app** (Vite + React, on-device mic/pitch, Three.js) fits Hobby as a static site. HTTPS is included, so the microphone works on phones without mkcert.

The **API cannot be dropped onto Vercel as-is.** It is a long-lived Node HTTP(S) server that persists users and progress in `apps/api/data/store.json`. Vercel Functions have an ephemeral filesystem; writes would not survive. Hobby is personal/non-commercial only (fair-use bandwidth ~100 GB, ~1M function invocations, etc.).

Reliable public URL for *practice UI*: yes, after a static deploy. Reliable *accounts and progress* without a database or localStorage rewrite: no.

Home LAN service remains the path for same-origin API + disk store on this PC.
