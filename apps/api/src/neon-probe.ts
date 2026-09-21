import { createServer } from "node:http";
import { createRequestListener } from "./http";
import { createPostgresStore } from "./store-postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const store = createPostgresStore(databaseUrl);
const server = createServer(
  createRequestListener({
    store,
    sessionSecret: "neon-probe",
    corsOrigin: "*",
  }),
);

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("expected tcp address");
}
const base = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${base}/health`);
  if (!health.ok) {
    throw new Error(`health ${health.status}`);
  }
  const email = `probe-${Date.now()}@pianolab.local`;
  const registered = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test" }),
  });
  const body = (await registered.json()) as { email?: string; error?: string };
  if (registered.status !== 201) {
    throw new Error(body.error ?? `register ${registered.status}`);
  }
  console.log("neon_ok", body.email);
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
