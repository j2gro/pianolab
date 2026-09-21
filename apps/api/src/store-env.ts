import { join } from "node:path";
import { apiRoot } from "./env";
import type { DataStore } from "./store";
import { createFileStore } from "./store-file";
import { createPostgresStore } from "./store-postgres";

export function createStoreFromEnv(): DataStore {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return createPostgresStore(databaseUrl);
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is required on Vercel");
  }
  return createFileStore(join(apiRoot, "data", "store.json"));
}
