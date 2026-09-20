# Pianolab

TypeScript monorepo for the web piano trainer POC.

```bash
npm install
npm run dev:api   # http://localhost:3001
npm run dev:web   # http://localhost:5173
```

POC loop: register → pick a Twinkle phrase → **Wait** (default) → Start. Notes fall to the keyboard and pause until the pitch is recognized. Mic stays in the browser; computer keys A–K (C4–C5) work if you do not have a piano. **Listen** plays a synth; completing a phrase in Wait persists after reload.
