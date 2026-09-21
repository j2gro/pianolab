import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import { loadDotEnv, resolveFromRepo } from "./env";
import { createRequestListener } from "./http";
import { createStoreFromEnv } from "./store-env";

loadDotEnv();

const staticDir = process.env.STATIC_DIR ? resolveFromRepo(process.env.STATIC_DIR) : null;
const tlsCertPath = process.env.TLS_CERT ? resolveFromRepo(process.env.TLS_CERT) : null;
const tlsKeyPath = process.env.TLS_KEY ? resolveFromRepo(process.env.TLS_KEY) : null;
const useTls = Boolean(tlsCertPath && tlsKeyPath);
const host = process.env.HOST || undefined;
const port = Number(process.env.PORT) || (staticDir ? (useTls ? 8443 : 8080) : 3001);
const corsOriginEnv = process.env.CORS_ORIGIN ?? (staticDir ? "*" : "http://localhost:5173");
const sessionSecret = process.env.SESSION_SECRET || "pianolab-poc-dev-secret";

if (staticDir && sessionSecret === "pianolab-poc-dev-secret") {
  console.warn("SESSION_SECRET is still the POC default. Set a random value in .env before using this on the LAN.");
}

if (useTls) {
  if (!tlsCertPath || !existsSync(tlsCertPath) || !tlsKeyPath || !existsSync(tlsKeyPath)) {
    throw new Error(`TLS_CERT / TLS_KEY must point at existing files (got ${tlsCertPath}, ${tlsKeyPath})`);
  }
}

if (staticDir && !existsSync(staticDir)) {
  throw new Error(`STATIC_DIR does not exist: ${staticDir}. Run npm run build --workspace=@pianolab/web first.`);
}

function lanUrls(scheme: string): string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const family = String(addr.family);
      if (addr.internal || (family !== "IPv4" && family !== "4")) {
        continue;
      }
      urls.push(`${scheme}://${addr.address}:${port}`);
    }
  }
  return urls;
}

const requestListener = createRequestListener({
  store: createStoreFromEnv(),
  sessionSecret,
  corsOrigin: corsOriginEnv,
  staticDir,
});

const server = useTls
  ? createHttpsServer(
      {
        cert: readFileSync(tlsCertPath!),
        key: readFileSync(tlsKeyPath!),
      },
      requestListener,
    )
  : createHttpServer(requestListener);

server.listen(port, host, () => {
  const scheme = useTls ? "https" : "http";
  const bind = host ?? "all-interfaces";
  console.log(`api listening on ${scheme}://localhost:${port} (bind ${bind})`);
  if (process.env.DATABASE_URL) {
    console.log("progress store: postgres (DATABASE_URL)");
  } else {
    console.log("progress store: file apps/api/data/store.json");
  }
  if (staticDir) {
    console.log(`serving static files from ${staticDir}`);
    for (const url of lanUrls(scheme)) {
      console.log(`LAN ${url}`);
    }
    if (!useTls) {
      console.warn("No TLS_CERT/TLS_KEY: browsers on other devices will likely block the microphone.");
    }
  }
});
