import { neon } from "@neondatabase/serverless";
import type { LessonProgress } from "@pianolab/lesson-schema";
import type { DataStore, UserRecord } from "./store";

function withoutChannelBinding(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "23505" || /duplicate key|unique constraint/i.test(message);
}

function asProgress(value: unknown): LessonProgress | null {
  if (typeof value === "string") {
    return JSON.parse(value) as LessonProgress;
  }
  if (typeof value === "object" && value !== null) {
    return value as LessonProgress;
  }
  return null;
}

export function createPostgresStore(databaseUrl: string): DataStore {
  const sql = neon(withoutChannelBinding(databaseUrl));
  let ready: Promise<void> | null = null;

  const boot = (): Promise<void> => {
    ready ??= (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS pianolab_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          salt TEXT NOT NULL,
          password_hash TEXT NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS pianolab_progress (
          user_id TEXT NOT NULL REFERENCES pianolab_users(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL,
          payload JSONB NOT NULL,
          PRIMARY KEY (user_id, lesson_id)
        )
      `;
    })();
    return ready;
  };

  return {
    async getUserByEmail(email) {
      await boot();
      const rows = await sql`
        SELECT id, email, salt, password_hash AS "passwordHash"
        FROM pianolab_users
        WHERE email = ${email}
        LIMIT 1
      `;
      const row = rows[0] as UserRecord | undefined;
      return row ?? null;
    },
    async getUserById(id) {
      await boot();
      const rows = await sql`
        SELECT id, email, salt, password_hash AS "passwordHash"
        FROM pianolab_users
        WHERE id = ${id}
        LIMIT 1
      `;
      const row = rows[0] as UserRecord | undefined;
      return row ?? null;
    },
    async createUser(user) {
      await boot();
      try {
        await sql`
          INSERT INTO pianolab_users (id, email, salt, password_hash)
          VALUES (${user.id}, ${user.email}, ${user.salt}, ${user.passwordHash})
        `;
        return { ok: true };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: false, error: "email_taken" };
        }
        throw error;
      }
    },
    async getProgress(userId, lessonId) {
      await boot();
      const rows = await sql`
        SELECT payload
        FROM pianolab_progress
        WHERE user_id = ${userId} AND lesson_id = ${lessonId}
        LIMIT 1
      `;
      const row = rows[0] as { payload?: unknown } | undefined;
      return row ? asProgress(row.payload) : null;
    },
    async putProgress(userId, next) {
      await boot();
      await sql`
        INSERT INTO pianolab_progress (user_id, lesson_id, payload)
        VALUES (${userId}, ${next.lessonId}, ${next})
        ON CONFLICT (user_id, lesson_id)
        DO UPDATE SET payload = EXCLUDED.payload
      `;
    },
  };
}
