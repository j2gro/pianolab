import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
console.log("vercel-build cwd", root);
console.log("node", process.version);

const npm = spawnSync("npm", ["run", "build", "--workspace=@pianolab/web"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (npm.status !== 0) {
  process.exit(npm.status ?? 1);
}

const candidates = [join(root, "apps/web/dist"), join(root, "dist")];
const source = candidates.find((dir) => existsSync(join(dir, "index.html")));
if (!source) {
  console.error("web build finished but index.html was not in apps/web/dist or dist");
  for (const dir of candidates) {
    console.error(dir, existsSync(dir) ? readdirSync(dir) : "missing");
  }
  process.exit(1);
}

const dest = join(root, "dist");
if (resolve(source) !== resolve(dest)) {
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
}

if (!existsSync(join(dest, "index.html"))) {
  console.error("dist/index.html missing after copy");
  process.exit(1);
}

console.log("output", dest, readdirSync(dest).join(", "));
