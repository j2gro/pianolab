import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(repoRoot, "apps/api/src/vercel-handler.ts");
const outfile = join(repoRoot, "apps/web/api/_handler.mjs");

mkdirSync(dirname(outfile), { recursive: true });

await build({
  absWorkingDir: repoRoot,
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
});

console.log("bundled api ->", outfile);
