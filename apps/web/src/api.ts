const TOKEN_KEY = "pianolab.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const res = await fetch(`/api${path}`, { ...init, headers });
  const raw = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(raw) as T & { error?: string };
  } catch {
    throw new Error(
      raw.startsWith("<") || raw.startsWith("The page")
        ? "API route is not deployed. Check /api/health on this host."
        : raw.slice(0, 180),
    );
  }
  if (!res.ok) {
    throw new Error(data.error ?? `request_failed_${res.status}`);
  }
  return data;
}

export function register(email: string, password: string) {
  return request<{ token: string; email: string }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function login(email: string, password: string) {
  return request<{ token: string; email: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function me() {
  return request<{ email: string }>("/me");
}

export function getProgress(lessonId: string) {
  return request<{ progress: import("@pianolab/lesson-schema").LessonProgress | null }>(
    `/progress?lessonId=${encodeURIComponent(lessonId)}`,
  );
}

export function putProgress(progress: import("@pianolab/lesson-schema").LessonProgress) {
  return request<{ progress: import("@pianolab/lesson-schema").LessonProgress }>("/progress", {
    method: "PUT",
    body: JSON.stringify(progress),
  });
}
