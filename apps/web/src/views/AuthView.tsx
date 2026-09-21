import { useState, type FormEvent } from "react";
import { login, register, setToken } from "../api";

export function AuthView({ onAuthed }: { onAuthed: (email: string) => void }) {
  const [email, setEmail] = useState("tester@pianolab.local");
  const [password, setPassword] = useState("test");
  const [mode, setMode] = useState<"login" | "register">("register");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fn = mode === "register" ? register : login;
      const result = await fn(email, password);
      setToken(result.token);
      onAuthed(result.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "auth_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="panel">
      <h1>Pianolab</h1>
      <p className="lede">Sign in to practice. Progress is stored on the API, not as audio.</p>
      <form onSubmit={onSubmit} className="form">
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            minLength={4}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {mode === "register" ? "Create account" : "Log in"}
        </button>
      </form>
      <button
        type="button"
        className="link"
        onClick={() => setMode(mode === "register" ? "login" : "register")}
      >
        {mode === "register" ? "Already have an account? Log in" : "Need an account? Register"}
      </button>
    </main>
  );
}
