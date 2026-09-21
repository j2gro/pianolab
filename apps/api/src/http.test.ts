import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createRequestListener } from "./http";
import { createMemoryStore } from "./store-memory";

async function withApi(
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server = createServer(
    createRequestListener({
      store: createMemoryStore(),
      sessionSecret: "test-secret",
      corsOrigin: "*",
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected tcp address");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("register, persist progress, and restore it", async () => {
  await withApi(async (base) => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);

    const registered = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.c", password: "test" }),
    });
    assert.equal(registered.status, 201);
    const session = (await registered.json()) as { token: string; email: string };
    assert.equal(session.email, "a@b.c");

    const auth = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };
    const me = await fetch(`${base}/me`, { headers: auth });
    assert.equal(me.status, 200);

    const saved = await fetch(`${base}/progress`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        lessonId: "twinkle-c-major",
        hits: 3,
        wrongs: 1,
        waitsMs: [10],
        completedPhraseIds: ["p1"],
        tempo: 90,
        lastPhraseId: "p1",
      }),
    });
    assert.equal(saved.status, 200);

    const loaded = await fetch(`${base}/progress?lessonId=twinkle-c-major`, { headers: auth });
    const body = (await loaded.json()) as { progress: { hits: number; lastPhraseId: string } };
    assert.equal(body.progress.hits, 3);
    assert.equal(body.progress.lastPhraseId, "p1");
  });
});
