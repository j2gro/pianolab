import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LessonProgress } from "@pianolab/lesson-schema";

const port = Number(process.env.PORT) || 3001;
const origin = process.env.CORS_ORIGIN || "http://localhost:5173";
const sessionSecret = process.env.SESSION_SECRET || "pianolab-poc-dev-secret";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../data");
const storePath = join(dataDir, "store.json");

type User = {
  id: string;
  email: string;
  salt: string;
  passwordHash: string;
};

type Store = {
  users: User[];
  progress: Record<string, LessonProgress>;
};

function emptyStore(): Store {
  return { users: [], progress: {} };
}

function loadStore(): Store {
  if (!existsSync(storePath)) {
    return emptyStore();
  }
  const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Store;
  return {
    users: parsed.users ?? [],
    progress: parsed.progress ?? {},
  };
}

function saveStore(store: Store): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

let store = loadStore();

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

function signToken(userId: string): string {
  const body = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length);
  const [body, sig] = token.split(".");
  if (!body || !sig) {
    return null;
  }
  const expected = createHmac("sha256", sessionSecret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
    userId: string;
    exp: number;
  };
  if (payload.exp < Date.now()) {
    return null;
  }
  return payload.userId;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) {
    return {};
  }
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid json");
  }
  return value as Record<string, unknown>;
}

function progressKey(userId: string, lessonId: string): string {
  return `${userId}:${lessonId}`;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      send(res, 204, {});
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/register") {
      const body = await parseJson(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (!email || password.length < 4) {
        send(res, 400, { error: "email and password (min 4 chars) required" });
        return;
      }
      if (store.users.some((user) => user.email === email)) {
        send(res, 409, { error: "email_taken" });
        return;
      }
      const salt = randomBytes(16).toString("hex");
      const user: User = {
        id: randomBytes(8).toString("hex"),
        email,
        salt,
        passwordHash: hashPassword(password, salt),
      };
      store.users.push(user);
      saveStore(store);
      send(res, 201, { token: signToken(user.id), email: user.email });
      return;
    }

    if (req.method === "POST" && url.pathname === "/auth/login") {
      const body = await parseJson(req);
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const user = store.users.find((item) => item.email === email);
      if (!user) {
        send(res, 401, { error: "invalid_credentials" });
        return;
      }
      const hash = hashPassword(password, user.salt);
      const a = Buffer.from(hash);
      const b = Buffer.from(user.passwordHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        send(res, 401, { error: "invalid_credentials" });
        return;
      }
      send(res, 200, { token: signToken(user.id), email: user.email });
      return;
    }

    const userId = readToken(req.headers.authorization);
    if (!userId) {
      send(res, 401, { error: "unauthorized" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/me") {
      const user = store.users.find((item) => item.id === userId);
      if (!user) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      send(res, 200, { email: user.email });
      return;
    }

    if (req.method === "GET" && url.pathname === "/progress") {
      const lessonId = url.searchParams.get("lessonId");
      if (!lessonId) {
        send(res, 400, { error: "lessonId required" });
        return;
      }
      send(res, 200, {
        progress: store.progress[progressKey(userId, lessonId)] ?? null,
      });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/progress") {
      const body = await parseJson(req);
      const lessonId = String(body.lessonId ?? "");
      if (!lessonId) {
        send(res, 400, { error: "lessonId required" });
        return;
      }
      const progress: LessonProgress = {
        lessonId,
        hits: Number(body.hits ?? 0),
        wrongs: Number(body.wrongs ?? 0),
        waitsMs: Array.isArray(body.waitsMs) ? body.waitsMs.map(Number) : [],
        completedPhraseIds: Array.isArray(body.completedPhraseIds)
          ? body.completedPhraseIds.map(String)
          : [],
        tempo: Number(body.tempo ?? 80),
        lastPhraseId: body.lastPhraseId ? String(body.lastPhraseId) : null,
      };
      store.progress[progressKey(userId, lessonId)] = progress;
      saveStore(store);
      send(res, 200, { progress });
      return;
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : "server_error" });
  }
});

server.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
