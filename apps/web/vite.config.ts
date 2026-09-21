import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);
const webRoot = path.dirname(fileURLToPath(import.meta.url));

function pkgDir(name: string): string {
  return path.dirname(require.resolve(`${name}/package.json`));
}

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "three"],
    alias: {
      react: pkgDir("react"),
      "react-dom": pkgDir("react-dom"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: path.resolve(webRoot, "../../dist"),
    emptyOutDir: true,
  },
});
