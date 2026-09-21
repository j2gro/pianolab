CREATE TABLE IF NOT EXISTS pianolab_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pianolab_progress (
  user_id TEXT NOT NULL REFERENCES pianolab_users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
