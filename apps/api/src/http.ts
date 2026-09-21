import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { LessonProgress } from "@pianolab/lesson-schema";
import type { DataStore } from "./store";
import { tryServeStatic } from "./static";

export type AppOptions = {
  store: DataStore;
  sessionSecret: string;
  corsOrigin: string;
  staticDir?: string | null;
};

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

function signToken(sessionSecret: string, userId: string): string {
  const body = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function readToken(sessionSecret: string, header: string | string[] | undefined): string | null {
  const raw = headerValue(header);
  if (!raw?.startsWith("Bearer ")) {
    return null;
  }
  const token = raw.slice("Bearer ".length);
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

function allowOrigin(req: IncomingMessage, corsOriginEnv: string): string {
  const requestOrigin = headerValue(req.headers.origin);
  if (corsOriginEnv === "*" || corsOriginEnv.toLowerCase() === "reflect") {
    return typeof requestOrigin === "string" && requestOrigin ? requestOrigin : "*";
  }
  return corsOriginEnv;
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  corsOriginEnv: string,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": allowOrigin(req, corsOriginEnv),
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  const preparsed = (req as IncomingMessage & { body?: unknown }).body;
  if (typeof preparsed === "string") {
    return Promise.resolve(preparsed);
  }
  if (preparsed && typeof preparsed === "object") {
    return Promise.resolve(JSON.stringify(preparsed));
  }
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

function apiPathname(pathname: string): string {
  if (pathname === "/api") {
    return "/";
  }
  if (pathname.startsWith("/api/")) {
    return pathname.slice("/api".length);
  }
  return pathname;
}

function parseProgress(body: Record<string, unknown>, lessonId: string): LessonProgress {
  return {
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
}

export function createRequestListener(options: AppOptions): RequestListener {
  const { store, sessionSecret, corsOrigin, staticDir } = options;
  const reply = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) =>
    send(req, res, corsOrigin, status, body);

  return async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        reply(req, res, 204, {});
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = apiPathname(url.pathname);

      if (req.method === "GET" && pathname === "/health") {
        reply(req, res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && pathname === "/auth/register") {
        const body = await parseJson(req);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (!email || password.length < 4) {
          reply(req, res, 400, { error: "email and password (min 4 chars) required" });
          return;
        }
        const salt = randomBytes(16).toString("hex");
        const user = {
          id: randomBytes(8).toString("hex"),
          email,
          salt,
          passwordHash: hashPassword(password, salt),
        };
        const created = await store.createUser(user);
        if (!created.ok) {
          reply(req, res, 409, { error: "email_taken" });
          return;
        }
        reply(req, res, 201, { token: signToken(sessionSecret, user.id), email: user.email });
        return;
      }

      if (req.method === "POST" && pathname === "/auth/login") {
        const body = await parseJson(req);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const user = await store.getUserByEmail(email);
        if (!user) {
          reply(req, res, 401, { error: "invalid_credentials" });
          return;
        }
        const hash = hashPassword(password, user.salt);
        const a = Buffer.from(hash);
        const b = Buffer.from(user.passwordHash);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          reply(req, res, 401, { error: "invalid_credentials" });
          return;
        }
        reply(req, res, 200, { token: signToken(sessionSecret, user.id), email: user.email });
        return;
      }

      const isAuthedApi =
        (req.method === "GET" && pathname === "/me") ||
        (req.method === "GET" && pathname === "/progress") ||
        (req.method === "PUT" && pathname === "/progress");

      if (isAuthedApi) {
        const userId = readToken(sessionSecret, req.headers.authorization);
        if (!userId) {
          reply(req, res, 401, { error: "unauthorized" });
          return;
        }

        if (req.method === "GET" && pathname === "/me") {
          const user = await store.getUserById(userId);
          if (!user) {
            reply(req, res, 401, { error: "unauthorized" });
            return;
          }
          reply(req, res, 200, { email: user.email });
          return;
        }

        if (req.method === "GET" && pathname === "/progress") {
          const lessonId = url.searchParams.get("lessonId");
          if (!lessonId) {
            reply(req, res, 400, { error: "lessonId required" });
            return;
          }
          reply(req, res, 200, {
            progress: await store.getProgress(userId, lessonId),
          });
          return;
        }

        const body = await parseJson(req);
        const lessonId = String(body.lessonId ?? "");
        if (!lessonId) {
          reply(req, res, 400, { error: "lessonId required" });
          return;
        }
        const progress = parseProgress(body, lessonId);
        await store.putProgress(userId, progress);
        reply(req, res, 200, { progress });
        return;
      }

      if (staticDir && tryServeStatic(req, res, url.pathname, staticDir)) {
        return;
      }

      reply(req, res, 404, { error: "not_found" });
    } catch (error) {
      reply(req, res, 500, { error: error instanceof Error ? error.message : "server_error" });
    }
  };
}
