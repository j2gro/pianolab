# Pianolab

TypeScript monorepo for the web piano trainer POC.

```bash
npm install
npm run dev:api   # http://localhost:3001
npm run dev:web   # http://localhost:5173
```

## Home network (this PC as the server)

Day-to-day coding still uses `dev:api` / `dev:web`. For other devices on your Wi-Fi, run one process that serves the production web build and the API on the same origin.

1. Install [mkcert](https://github.com/FiloSottile/mkcert) (Scoop: `scoop install mkcert`, or Chocolatey: `choco install mkcert`) so browsers treat the LAN URL as HTTPS. The microphone needs a trusted certificate on each device.
2. From the repo root:

```powershell
powershell -File scripts\home-serve.ps1
```

That builds the web app, writes `.env` if missing, issues `certs/lan.pem` for localhost plus your current LAN IPs, and listens on **https://LAN-IP:8443**. If mkcert is missing it falls back to **http://LAN-IP:8080** (keys A–K still work; mic usually will not).

3. Allow inbound TCP **8443** (or **8080**) in Windows Firewall if other devices time out. `scripts\install-home-task.ps1` tries to add a rule named `Pianolab Home`.
4. On phones and other PCs, install `certs\pianolab-rootCA.pem` (copied from mkcert’s CA) into the trusted root store, then open the `LAN https://…` URL printed in the console. Re-run with `-RenewCerts` if this PC’s IP changed.

Start at Windows logon (and restart if the process dies):

```powershell
powershell -File scripts\install-home-task.ps1
```

The task uses `-SkipBuild`, so after pulling code run `home-serve.ps1` once by hand. Remove with `scripts\uninstall-home-task.ps1`. Do not port-forward these ports to the internet.

Set `DATABASE_URL` in `.env` if you want this PC to share accounts and progress with the Vercel deploy. Otherwise progress stays in `apps/api/data/store.json`.

## Vercel (Hobby) + Neon

Public HTTPS URL for the trainer. The Vite app is static; auth and progress go through one Node function to a free Neon database.

1. Create a project at [neon.tech](https://neon.tech) (free tier). Copy the connection string (`DATABASE_URL`).
2. In [Vercel](https://vercel.com), import this repo. Framework preset **Other**, root directory **`.`** (not `apps/web`). In Build & Development Settings, turn **off** the Output Directory override so `vercel.json` can set `dist`. Hobby is personal/non-commercial only.
3. Project environment variables:
   - `DATABASE_URL` — Neon URI
   - `SESSION_SECRET` — long random string (not the POC default)
4. Deploy. Open `https://<project>.vercel.app`. Tables are created on first API request (`apps/api/schema.sql` is the same DDL).

CLI from the repo root after `npm i -g vercel` (or `npx vercel`):

```bash
npx vercel
```

Then set the two env vars in the Vercel dashboard (or `npx vercel env add`) and redeploy. `/api/health` should return `{"ok":true}`.

POC loop: register → pick a song (Twinkle, Mary, or the two-hand Mary arrangement) → **Wait** (default) → Start. Notes fall to the keyboard and pause until the pitch is recognized. Mic stays in the browser; computer keys A–K (C4–C5) work if you do not have a piano. **Listen** plays a synth; completing a phrase in Wait persists after reload.

## Authoring a song

Lessons are JSON in `packages/lesson-schema/src/lessons/`. The practice app loads the catalog from `@pianolab/lesson-schema`. Import writes a draft file you can edit. New `.mxl` drops in `C:\sheet_music` can be scanned into the catalog with `lesson:ingest-mxl`.

**MIDI and MusicXML:** export from MuseScore, LilyPond, or a DAW. Public-domain teaching pieces often have MIDI or MXL on [MuseScore.com](https://musescore.com), [Mutopia](https://www.mutopiaproject.org), or [IMSLP](https://imslp.org). MIDI import keeps a single melody track. MusicXML/MXL keeps both piano staves unless you pass `--hands melody`. Do not commit copyrighted pop scores; keep source `.mid` / `.mxl` files out of git unless the license is clear.

```bash
npm run lesson:import -- path/to/song.mid --list-tracks
npm run lesson:import -- path/to/song.mid \
  --id ode-to-joy --title "Ode to Joy" --composer Beethoven \
  --track 0 --grid 16 --phrase-bars 4 \
  --out packages/lesson-schema/src/lessons/ode-to-joy.json

npm run lesson:import -- path/to/song.mxl \
  --id mary-two-hands --title "Mary Had a Little Lamb" --composer Traditional \
  --hands both --phrase-bars 4 \
  --out packages/lesson-schema/src/lessons/mary-had-a-little-lamb-two-hands.json
```

Then hand-edit `finger`, optional `lyric`, and phrase `title` values. Fingering from import is a draft so the file validates. Audio-to-MIDI is not part of this tool.

```bash
npm run lesson:ingest-mxl -- --dry-run
npm run lesson:ingest-mxl
```

Ingest skips `.mxl` files whose slug or score title already matches a catalog lesson, writes JSON under `src/lessons/`, and regenerates `src/catalog.generated.ts`. Default difficulty is beginner; pass `--difficulty` / `--hands` if needed. Do not commit copyrighted pop scores.
