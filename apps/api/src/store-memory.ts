import type { LessonProgress } from "@pianolab/lesson-schema";
import type { DataStore, UserRecord } from "./store";

function progressKey(userId: string, lessonId: string): string {
  return `${userId}:${lessonId}`;
}

export function createMemoryStore(): DataStore {
  const users: UserRecord[] = [];
  const progress = new Map<string, LessonProgress>();

  return {
    async getUserByEmail(email) {
      return users.find((user) => user.email === email) ?? null;
    },
    async getUserById(id) {
      return users.find((user) => user.id === id) ?? null;
    },
    async createUser(user) {
      if (users.some((item) => item.email === user.email)) {
        return { ok: false, error: "email_taken" };
      }
      users.push(user);
      return { ok: true };
    },
    async getProgress(userId, lessonId) {
      return progress.get(progressKey(userId, lessonId)) ?? null;
    },
    async putProgress(userId, next) {
      progress.set(progressKey(userId, next.lessonId), next);
    },
  };
}
