import type { LessonProgress } from "@pianolab/lesson-schema";

export type UserRecord = {
  id: string;
  email: string;
  salt: string;
  passwordHash: string;
};

export type DataStore = {
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUserById(id: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<{ ok: true } | { ok: false; error: "email_taken" }>;
  getProgress(userId: string, lessonId: string): Promise<LessonProgress | null>;
  putProgress(userId: string, progress: LessonProgress): Promise<void>;
};
