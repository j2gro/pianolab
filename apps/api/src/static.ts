import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safeFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) {
    return null;
  }
  const abs = resolve(root, decoded.replace(/^\/+/, ""));
  const rel = relative(root, abs);
  if (!rel || isAbsolute(rel) || rel.split(sep).includes("..")) {
    return null;
  }
  return abs;
}

function sendFile(res: ServerResponse, filePath: string, cache: boolean): void {
  const ext = extname(filePath).toLowerCase();
  const body = readFileSync(filePath);
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": cache ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(body);
}

export function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  staticRoot: string,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const candidate = safeFile(staticRoot, pathname === "/" ? "/index.html" : pathname);
  if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
    sendFile(res, candidate, pathname.startsWith("/assets/"));
    return true;
  }

  const hasExt = extname(pathname) !== "";
  if (hasExt) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return true;
  }

  const indexPath = join(staticRoot, "index.html");
  if (existsSync(indexPath)) {
    sendFile(res, indexPath, false);
    return true;
  }

  return false;
}
