import { loadDotEnv } from "../apps/api/src/env";
import { createRequestListener } from "../apps/api/src/http";
import { createStoreFromEnv } from "../apps/api/src/store-env";

loadDotEnv();

const sessionSecret = process.env.SESSION_SECRET || "pianolab-poc-dev-secret";
if (sessionSecret === "pianolab-poc-dev-secret") {
  console.warn("SESSION_SECRET is still the POC default. Set it in the Vercel project environment.");
}

const listener = createRequestListener({
  store: createStoreFromEnv(),
  sessionSecret,
  corsOrigin: process.env.CORS_ORIGIN ?? "reflect",
  staticDir: null,
});

export default listener;

export const config = {
  runtime: "nodejs",
  maxDuration: 10,
};
