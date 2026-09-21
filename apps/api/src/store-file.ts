import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LessonProgress } from "@pianolab/lesson-schema";
import type { DataStore, UserRecord } from "./store";

type FileShape = {
  users: UserRecord[];
  progress: Record<string, LessonProgress>;
};

function progressKey(userId: string, lessonId: string): string {
  return `${userId}:${lessonId}`;
}

function empty(): FileShape {
  return { users: [], progress: {} };
}

export function createFileStore(storePath: string): DataStore {
  const load = (): FileShape => {
    if (!existsSync(storePath)) {
      return empty();
    }
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as FileShape;
    return {
      users: parsed.users ?? [],
      progress: parsed.progress ?? {},
    };
  };

  const save = (data: FileShape): void => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify(data, null, 2));
  };

  return {
    async getUserByEmail(email) {
      return load().users.find((user) => user.email === email) ?? null;
    },
    async getUserById(id) {
      return load().users.find((user) => user.id === id) ?? null;
    },
    async createUser(user) {
      const data = load();
      if (data.users.some((item) => item.email === user.email)) {
        return { ok: false, error: "email_taken" };
      }
      data.users.push(user);
      save(data);
      return { ok: true };
    },
    async getProgress(userId, lessonId) {
      return load().progress[progressKey(userId, lessonId)] ?? null;
    },
    async putProgress(userId, next) {
      const data = load();
      data.progress[progressKey(userId, next.lessonId)] = next;
      save(data);
    },
  };
}
